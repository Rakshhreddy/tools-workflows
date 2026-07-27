#!/usr/bin/env python3
"""
Check the corpus before it ships.

The interface computes its findings from this file, so a dangling tool id or a
designer with no source does not fail loudly at runtime, it just quietly makes
a claim wrong. Run this after adding an interview.

    python3 scripts/validate.py

Exits non-zero on any error. Warnings do not fail the run: they flag things
worth a look, most usefully a designer encoded far more thinly than the rest,
which makes them read as a minimalist when they are only under-encoded.
"""
import json, sys, collections, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "landscape.json"

errors, warnings = [], []


def err(msg): errors.append(msg)
def warn(msg): warnings.append(msg)


def main():
    d = json.loads(DATA.read_text())

    stages = {s["id"] for s in d["meta"]["stages"]}
    companies = {c["id"] for c in d["companies"]}
    designers = {p["id"] for p in d["designers"]}
    tools = {t["id"] for t in d["tools"]}

    # --- ids are unique -----------------------------------------------------
    for key in ("companies", "designers", "tools"):
        seen = collections.Counter(x["id"] for x in d[key])
        for i, n in seen.items():
            if n > 1:
                err(f"{key}: duplicate id {i!r} appears {n} times")

    # --- required fields ----------------------------------------------------
    for c in d["companies"]:
        if not c.get("name"):
            err(f"company {c['id']}: missing name")

    for p in d["designers"]:
        for field in ("name", "role", "thesis", "companyId", "source"):
            if not p.get(field):
                err(f"designer {p['id']}: missing {field}")
        if p.get("companyId") and p["companyId"] not in companies:
            err(f"designer {p['id']}: companyId {p['companyId']!r} is not a company")
        src = p.get("source") or {}
        for field in ("title", "url"):
            if not src.get(field):
                err(f"designer {p['id']}: source.{field} missing")
        if src.get("url") and "watch?v=" not in src["url"]:
            warn(f"designer {p['id']}: source url is not a YouTube watch link, "
                 f"so timestamp deep links will not work")

    for t in d["tools"]:
        if not t.get("name"):
            err(f"tool {t['id']}: missing name")
        if t.get("stage") not in stages:
            err(f"tool {t['id']}: stage {t.get('stage')!r} is not one of {sorted(stages)}")

    # --- referential integrity ---------------------------------------------
    def check_ref(kind, i, field, value, pool, poolname):
        if value not in pool:
            err(f"{kind}[{i}]: {field} {value!r} is not a known {poolname}")

    for i, u in enumerate(d["uses"]):
        check_ref("uses", i, "toolId", u.get("toolId"), tools, "tool")
        check_ref("uses", i, "designerId", u.get("designerId"), designers, "designer")
        if not u.get("purpose"):
            err(f"uses[{i}]: empty purpose")

    for i, m in enumerate(d["moves"]):
        check_ref("moves", i, "from", m.get("from"), tools, "tool")
        check_ref("moves", i, "to", m.get("to"), tools, "tool")
        check_ref("moves", i, "designerId", m.get("designerId"), designers, "designer")
        if m.get("from") == m.get("to"):
            err(f"moves[{i}]: from and to are the same tool ({m.get('from')})")
        if not m.get("reason"):
            err(f"moves[{i}]: empty reason, so the handoff says nothing")

    for i, c in enumerate(d["choices"]):
        check_ref("choices", i, "a", c.get("a"), tools, "tool")
        check_ref("choices", i, "b", c.get("b"), tools, "tool")
        check_ref("choices", i, "designerId", c.get("designerId"), designers, "designer")
        if c.get("a") == c.get("b"):
            err(f"choices[{i}]: a and b are the same tool")
        if not c.get("criterion"):
            err(f"choices[{i}]: empty criterion")

    for i, h in enumerate(d["handoff"]):
        check_ref("handoff", i, "designerId", h.get("designerId"), designers, "designer")
        if not h.get("claim"):
            err(f"handoff[{i}]: empty claim")

    # --- every timestamp must deep link somewhere real ----------------------
    for key, field in (("uses", "at"), ("moves", "at"), ("choices", "at"), ("handoff", "at")):
        for i, row in enumerate(d[key]):
            at = row.get(field)
            if not isinstance(at, int) or at < 0:
                err(f"{key}[{i}]: {field} must be a non-negative integer of seconds, got {at!r}")

    # --- orphans ------------------------------------------------------------
    referenced = set()
    for u in d["uses"]:
        referenced.add(u.get("toolId"))
    for m in d["moves"]:
        referenced.update((m.get("from"), m.get("to")))
    for t in sorted(tools - referenced):
        err(f"tool {t!r} is defined but never used or moved through, so it "
            f"renders as a node with nothing attached")

    for c in sorted(companies - {p["companyId"] for p in d["designers"]}):
        warn(f"company {c!r} has no designers")

    # --- encoding depth -----------------------------------------------------
    # Uneven depth is not invalid, but it distorts every finding, so it is
    # worth seeing every time the corpus changes.
    depth = collections.defaultdict(set)
    for u in d["uses"]:
        depth[u["designerId"]].add(u["toolId"])
    for m in d["moves"]:
        depth[m["designerId"]].update((m["from"], m["to"]))

    counts = {p["id"]: len(depth.get(p["id"], ())) for p in d["designers"]}
    if counts:
        typical = sorted(counts.values())[len(counts) // 2]
        for p in d["designers"]:
            n = counts[p["id"]]
            if n == 0:
                err(f"designer {p['id']}: no tools encoded at all")
            elif n * 2 < typical:
                warn(f"designer {p['id']} ({p['name']}): {n} tools against a typical {typical}. "
                     f"Thin enough to misrepresent them in any comparison.")

    # --- report -------------------------------------------------------------
    print(f"corpus: {len(d['designers'])} designers, {len(d['companies'])} companies, "
          f"{len(d['tools'])} tools, {len(d['uses'])} uses, {len(d['moves'])} moves, "
          f"{len(d['choices'])} choices, {len(d['handoff'])} handoff claims")
    print("depth per designer: " + ", ".join(
        f"{p['name'].split()[0]} {counts[p['id']]}"
        for p in sorted(d["designers"], key=lambda p: -counts[p["id"]])))

    for w in warnings:
        print(f"  warn   {w}")
    for e in errors:
        print(f"  ERROR  {e}")

    if errors:
        print(f"\n{len(errors)} error(s). Fix before shipping.")
        return 1
    print(f"\nclean{f', {len(warnings)} warning(s)' if warnings else ''}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
