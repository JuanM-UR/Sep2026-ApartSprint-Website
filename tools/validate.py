#!/usr/bin/env python3
"""Dev-only validator for site/data.json.

Not shipped to the page. Mirrors the JavaScript engine exactly so that the
computed matrix can be checked from the command line, and fails loudly on
malformed data. Run from the `site/` directory:

    uv run python tools/validate.py
    uv run python tools/validate.py --trace wiki eu_art85
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data.json"

CONDITIONS = ["filer", "threshold", "visibility"]
FACTS = ["legalBasis", "authority"]
AXIS_ORDER = CONDITIONS + FACTS
AXIS_IDS = set(AXIS_ORDER)
GATE_AXES = set(CONDITIONS)
THRESHOLD_VALUES = {"meets", "below", "contested", "unknown"}
GATE_FAILURES = {"locked", "contested", "excluded", "confidential", "below-threshold", "dismissed"}

# mirrors CATEGORY in app.js
CATEGORY = {
    "fileable": "fileable",
    "contested": "contested",
    "locked": "locked",
    "excluded": "locked",
    "below-threshold": "locked",
    "dismissed": "locked",
    "confidential": "other",
    "unknown": "other",
    "no-legal-effect": "other",
}

errors: list[str] = []
warnings: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def warn(message: str) -> None:
    warnings.append(message)


# --- engine (must match app.js) ---------------------------------------------
def verdict_status(axis: str, value: str | None) -> str:
    if axis == "threshold":
        if value == "meets":
            return "pass"
        if value == "below":
            return "below-threshold"
        if value == "contested":
            return "contested"
        return "unknown"
    return "unknown"


def gate_status_for(instrument: dict, case: dict, axis: str) -> dict:
    gate = next((g for g in instrument.get("gates", []) if g["axis"] == axis), None)
    if gate is None:
        return {"axis": axis, "status": "not-applicable"}

    if gate["scope"] == "instrument":
        return {
            "axis": axis,
            "status": "pass" if gate.get("pass") else gate["failure"],
            "citation": instrument.get("sourceUrl"),
            "noteKey": gate.get("noteKey"),
            "noteCitation": gate.get("noteCitation"),
        }

    verdict = (case.get("verdicts") or {}).get(instrument["id"], {}).get(axis)
    return {
        "axis": axis,
        "status": verdict_status(axis, verdict.get("value") if verdict else None),
        "citation": (verdict or {}).get("citation"),
        "noteKey": (verdict or {}).get("noteKey") or gate.get("noteKey"),
        "noteCitation": (verdict or {}).get("noteCitation") or gate.get("noteCitation"),
    }


def status_of(instrument: dict, case: dict) -> dict:
    gates = [gate_status_for(instrument, case, axis) for axis in CONDITIONS]
    blockers = [g for g in gates if g["status"] not in ("pass", "not-applicable")]
    if blockers:
        return {"outcome": blockers[0]["status"], "primary": blockers[0], "gates": gates}
    if instrument.get("legalEffect") is False:
        return {"outcome": "no-legal-effect", "primary": None, "gates": gates}
    return {"outcome": "fileable", "primary": None, "gates": gates}


# --- validation --------------------------------------------------------------
def is_url(value) -> bool:
    return isinstance(value, str) and value.startswith(("http://", "https://"))


def validate(data: dict) -> None:
    if "meta" not in data:
        fail("missing meta")

    axes = data.get("axes", [])
    axis_ids = [a["id"] for a in axes]
    if axis_ids != AXIS_ORDER:
        fail(f"axes must match the declared order exactly, got {axis_ids}")
    if len(axis_ids) != len(set(axis_ids)):
        fail("duplicate axis ids")
    for axis in axes:
        expected = "condition" if axis.get("id") in GATE_AXES else "fact"
        if axis.get("kind") != expected:
            fail(f"axis {axis.get('id')} kind must be {expected}, got {axis.get('kind')!r}")

    instrument_ids = [i["id"] for i in data.get("instruments", [])]
    if len(instrument_ids) != len(set(instrument_ids)):
        fail("duplicate instrument ids")
    for instrument in data.get("instruments", []):
        iid = instrument["id"]
        for key in ("nameKey", "entryPoint", "asOf"):
            if not instrument.get(key):
                fail(f"instrument {iid} missing {key}")
        if not is_url(instrument.get("sourceUrl")):
            fail(f"instrument {iid} has no url sourceUrl")
        if instrument.get("encoded") is not True:
            warn(f"instrument {iid} not marked encoded")
        seen_axes = set()
        for gate in instrument.get("gates", []):
            if gate.get("axis") not in GATE_AXES:
                fail(f"instrument {iid} gate on non-condition axis: {gate.get('axis')}")
            if gate.get("axis") in seen_axes:
                fail(f"instrument {iid} has duplicate gate for axis {gate.get('axis')}")
            seen_axes.add(gate.get("axis"))
            if gate.get("scope") not in ("instrument", "case"):
                fail(f"instrument {iid} gate has bad scope: {gate.get('scope')}")
            if gate.get("scope") == "instrument":
                has_failure = gate.get("failure") in GATE_FAILURES
                has_pass = gate.get("pass") is True
                if has_failure == has_pass:
                    fail(
                        f"instrument {iid} gate {gate.get('axis')} must have exactly one of "
                        f"failure ({gate.get('failure')!r}) or pass:true"
                    )
            if gate.get("noteCitation") and not is_url(gate["noteCitation"]):
                fail(f"instrument {iid} gate {gate.get('axis')} bad noteCitation")
        has_pass_filer = any(
            g.get("pass") and g.get("axis") == "filer" for g in instrument.get("gates", [])
        )
        if instrument.get("entryPoint") == "any_person" and not has_pass_filer:
            fail(f"instrument {iid} is any_person but has no passing filer gate")
        if has_pass_filer and instrument.get("entryPoint") != "any_person":
            fail(
                f"instrument {iid} has a passing filer gate but entryPoint is "
                f"{instrument.get('entryPoint')}"
            )
        for fact in FACTS:
            if not instrument.get(f"{fact}Key"):
                fail(f"instrument {iid} missing {fact}Key")

    case_ids = [c["id"] for c in data.get("cases", [])]
    if len(case_ids) != len(set(case_ids)):
        fail("duplicate case ids")
    for case in data.get("cases", []):
        cid = case["id"]
        for key in ("nameKey", "summaryKey"):
            if not case.get(key):
                fail(f"case {cid} missing {key}")
        if not case.get("sources") and not case.get("hypothetical"):
            warn(f"case {cid} has no public sources yet")
        for instrument_id, axes in (case.get("verdicts") or {}).items():
            if instrument_id not in instrument_ids:
                fail(f"case {cid} has verdicts for unknown instrument {instrument_id}")
            for axis, verdict in axes.items():
                if axis not in GATE_AXES:
                    fail(f"case {cid}/{instrument_id} verdict on non-condition axis {axis}")
                    continue
                if axis != "threshold":
                    fail(f"case {cid}/{instrument_id} verdicts only apply to threshold, got {axis}")
                    continue
                value = verdict.get("value")
                if value not in THRESHOLD_VALUES:
                    fail(f"case {cid}/{instrument_id}/{axis} bad value: {value}")
                if verdict.get("noteCitation") and not is_url(verdict["noteCitation"]):
                    fail(f"case {cid}/{instrument_id}/{axis} bad noteCitation")
                if value in ("unknown", "unresolved", None):
                    continue
                if verdict.get("citationPending"):
                    warn(f"case {cid}/{instrument_id}/{axis} '{value}' citation pending")
                elif not is_url(verdict.get("citation")):
                    fail(f"case {cid}/{instrument_id}/{axis} value '{value}' has no url citation")

    for item in data.get("featured", []):
        if item.get("case") not in case_ids:
            fail(f"featured entry references unknown case: {item.get('case')}")
        if item.get("instrument") not in instrument_ids:
            fail(f"featured entry references unknown instrument: {item.get('instrument')}")
        if not item.get("headlineKey"):
            fail(f"featured entry {item.get('case')}/{item.get('instrument')} missing headlineKey")

    hypo = data.get("hypothetical")
    if hypo:
        if hypo.get("case") not in case_ids:
            fail(f"hypothetical references unknown case: {hypo.get('case')}")
        for item in hypo.get("cards", []):
            if item.get("instrument") not in instrument_ids:
                fail(f"hypothetical card references unknown instrument: {item.get('instrument')}")
            if not item.get("headlineKey"):
                fail(f"hypothetical card {item.get('instrument')} missing headlineKey")


def print_matrix(data: dict) -> None:
    instruments = data["instruments"]
    cases = [c for c in data["cases"] if not c.get("hypothetical")]
    width = max(len(c["id"]) for c in cases) + 2
    print(f"\n{'case':<{width}}" + "".join(f"{i['id']:>15}" for i in instruments))
    print("-" * (width + 15 * len(instruments)))
    for case in cases:
        cells = "".join(f"{status_of(i, case)['outcome']:>15}" for i in instruments)
        print(f"{case['id']:<{width}}{cells}")


def print_trace(data: dict, case_id: str, instrument_id: str) -> None:
    case = next((c for c in data["cases"] if c["id"] == case_id), None)
    instrument = next((i for i in data["instruments"] if i["id"] == instrument_id), None)
    if case is None or instrument is None:
        print(f"\nCannot trace {case_id} / {instrument_id}: unknown id")
        return
    result = status_of(instrument, case)
    print(f"\ntrace: {case_id} x {instrument_id} -> {result['outcome']}")
    for gate in result["gates"]:
        note = " [note]" if gate.get("noteKey") else ""
        print(f"  {gate['axis']:<15} {gate['status']}{note}")
    for fact in FACTS:
        key = instrument.get(f"{fact}Key")
        if key:
            print(f"  {fact:<15} [fact] {key}")


def main() -> int:
    args = sys.argv[1:]
    data = json.loads(DATA.read_text(encoding="utf-8"))
    validate(data)

    for warning in warnings:
        print(f"WARN  {warning}")
    for error in errors:
        print(f"ERROR {error}")

    print_matrix(data)

    fileable = [
        (c["id"], i["id"])
        for c in data["cases"]
        if not c.get("hypothetical")
        for i in data["instruments"]
        if status_of(i, c)["outcome"] == "fileable"
    ]
    print(f"\nfileable cells: {fileable if fileable else 'none'}")

    if args and args[0] == "--trace" and len(args) == 3:
        print_trace(data, args[1], args[2])

    print(f"{len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())