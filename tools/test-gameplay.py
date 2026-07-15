#!/usr/bin/env python3
"""End-to-end gameplay regression test for the local Spiralfall preview."""

import math
from pathlib import Path
import time
from playwright.sync_api import sync_playwright


URL = "http://127.0.0.1:5173/game.html?skipIntro=1"
ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts" / "qa"
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def number(page, name: str) -> float:
    value = page.locator("body").get_attribute(f"data-{name}")
    if value is None:
        raise AssertionError(f"missing debug state: data-{name}")
    return float(value)


def expected_visual_segment(rotation_y: float) -> int:
    """Shared sector [0, τ/8] rotated by -i·τ/8 sits under +Z at ceil((π/2+rot)/step)."""
    angle_step = (math.pi * 2) / 8
    alpha = (math.pi / 2 + rotation_y) % (math.pi * 2)
    if alpha < 0:
        alpha += math.pi * 2
    return int(math.ceil(alpha / angle_step - 1e-9)) % 8


def assert_collision_matches_render(page) -> None:
    rotation = number(page, "rotation-y")
    active = int(number(page, "active-segment"))
    expected = expected_visual_segment(rotation)
    assert active == expected, (
        f"collision checks segment {active}, but rendered segment {expected} "
        f"is below the ball at rotation {rotation}"
    )
    probe = page.evaluate(
        "() => window.__THREE_GAME_DIAGNOSTICS__.visualSegmentUnderBall"
    )
    assert probe and probe["aligned"], (
        f"world-space plate under ball {probe} does not match collision"
    )
    if probe.get("plateSeg") is not None:
        assert probe["plateSeg"] == active, (
            f"collision segment {active} but plate under ball is {probe['plateSeg']}"
        )


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 390, "height": 844})
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    page.goto(URL, wait_until="load", timeout=15_000)
    page.wait_for_selector("body[data-phase='playing']", timeout=5_000)
    assert_collision_matches_render(page)
    assert "show" not in (page.locator("#toast").get_attribute("class") or ""), (
        "instruction banner should not cover gameplay"
    )
    for selector in ("#btn-left", "#btn-right", "#btn-sound", "#btn-pause"):
        target = page.locator(selector).bounding_box()
        assert target is not None, f"{selector} is not rendered"
        assert target["width"] >= 44 and target["height"] >= 44, (
            f"{selector} is smaller than a mobile touch target: {target}"
        )

    # The run auto-starts and the ball must visibly move under gravity.
    # Restart synchronously so the samples always cover the opening drop even
    # when headless startup spent time compiling WebGL shaders.
    page.locator("#btn-daily").evaluate("(button) => button.click()")
    samples: list[float] = []
    for _ in range(12):
        samples.append(number(page, "ball-y"))
        time.sleep(0.05)
    assert max(samples) - min(samples) > 1.0, f"ball did not visibly fall: {samples}"

    # Pause is a real game state and must resume without resetting the run.
    page.locator("#btn-pause").click()
    page.wait_for_selector("body[data-phase='paused']", timeout=1_000)
    assert page.locator("#pause-panel").is_visible(), "pause overlay is missing"
    page.locator("#btn-resume").click()
    page.wait_for_selector("body[data-phase='playing']", timeout=1_000)

    # Holding a control must rotate the tower and produce downward progress.
    button = page.locator("#btn-right")
    bounds = button.bounding_box()
    assert bounds is not None, "right control is not rendered"
    page.mouse.move(bounds["x"] + bounds["width"] / 2, bounds["y"] + bounds["height"] / 2)
    page.mouse.down()
    deadline = time.monotonic() + 5
    while int(number(page, "depth")) < 4 and time.monotonic() < deadline:
        time.sleep(0.1)
    page.mouse.up()

    assert int(number(page, "depth")) >= 4, "run did not advance through the tower"
    assert_collision_matches_render(page)
    sound_events = int(number(page, "sound-events"))
    assert sound_events > 0, "gameplay produced no audio events after user input"
    page.locator("#btn-sound").click()
    assert page.locator("#btn-sound").get_attribute("aria-pressed") == "true"
    page.locator("#btn-sound").click()
    assert page.locator("#btn-sound").get_attribute("aria-pressed") == "false"

    renderer = page.evaluate("window.__THREE_GAME_DIAGNOSTICS__.renderer")
    assert renderer["calls"] <= 150, f"mobile draw-call budget exceeded: {renderer}"
    assert renderer["triangles"] <= 300_000, f"mobile triangle budget exceeded: {renderer}"
    assert not errors, f"browser errors: {errors}"

    # Continue until a real end state, then verify retry fully resets the run.
    page.mouse.move(bounds["x"] + bounds["width"] / 2, bounds["y"] + bounds["height"] / 2)
    page.mouse.down()
    deadline = time.monotonic() + 22
    while (
        page.locator("body").get_attribute("data-phase") == "playing"
        and time.monotonic() < deadline
    ):
        time.sleep(0.1)
    page.mouse.up()

    end_phase = page.locator("body").get_attribute("data-phase")
    assert end_phase in {"dead", "cleared"}, f"run never ended: {end_phase}"
    assert page.locator("#btn-retry").is_visible(), "retry is missing at run end"

    page.locator("#btn-retry").click()
    page.wait_for_selector("body[data-phase='playing']", timeout=2_000)
    assert int(number(page, "depth")) <= 1, "retry did not reset depth"
    assert page.locator("#controls").is_visible(), "controls did not return after retry"

    # Desktop drag input must also rotate the tower and advance the run.
    drag_deadline = time.monotonic() + 5
    while (
        int(number(page, "depth")) < 3
        and page.locator("body").get_attribute("data-phase") == "playing"
        and time.monotonic() < drag_deadline
    ):
        page.mouse.move(60, 420)
        page.mouse.down()
        page.mouse.move(330, 420, steps=12)
        page.mouse.up()
        time.sleep(0.25)
    assert int(number(page, "depth")) >= 3, "drag input did not advance the retry run"
    assert not errors, f"browser errors after retry: {errors}"

    screenshot = ARTIFACTS / "mobile-regression.png"
    page.screenshot(path=str(screenshot))
    print(
        "PASS",
        {
            "fall_distance": round(max(samples) - min(samples), 2),
            "sound_events": sound_events,
            "first_run_end": end_phase,
            "drag_retry_depth": int(number(page, "depth")),
            "retry_phase": page.locator("body").get_attribute("data-phase"),
            "renderer": renderer,
            "screenshot": str(screenshot),
        },
    )
    browser.close()
