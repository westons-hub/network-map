"""Answer "who can introduce me to X?" from your contact list.

X can be a company (matched like group names, so "EY" finds "Ernst & Young")
or part of a person's name. For each match we walk the "Connected Through"
chain back to you, so a 3rd-degree contact shows the full path:
You -> Liam Walsh -> Zoe Adams -> Sam Rivera.
"""

from __future__ import annotations

from dataclasses import dataclass

from .graph import normalize_org
from .loader import Person, normalize_name


@dataclass
class IntroPath:
    person: Person
    chain: list[str]  # names from your first contact to the person (inclusive)

    @property
    def degree(self) -> int:
        return len(self.chain)

    @property
    def ask(self) -> str:
        """Who you should talk to first."""
        return self.chain[0]


def _chain(p: Person, by_key: dict[str, Person], me_key: str) -> list[str]:
    chain = [p.name]
    seen = {p.key}
    current = p
    while current.connected_through:
        ck = normalize_name(current.connected_through)
        if ck == me_key or ck in seen:
            break
        seen.add(ck)
        current = by_key.get(ck) or Person(name=current.connected_through)
        chain.insert(0, current.name)
    return chain


def who_can_intro(people: list[Person], query: str, me: str = "Me") -> list[IntroPath]:
    """Everyone matching ``query`` (company or name), with the path from you to them.

    Shortest paths come first, so the easiest intro is at the top.
    """
    me_key = normalize_name(me)
    by_key = {p.key: p for p in people if p.key != me_key}
    org_key = normalize_org(query)
    q = query.strip().casefold()
    if not q:
        return []
    words = set(q.split())
    # Whole-word name match, so "EY" finds Ernst & Young but not "Casey".
    matches = [p for p in by_key.values()
               if (p.company and normalize_org(p.company) == org_key)
               or words <= set(p.name.casefold().split())]
    paths = [IntroPath(p, _chain(p, by_key, me_key)) for p in matches]
    return sorted(paths, key=lambda x: (x.degree, x.person.name))


def _describe(path: IntroPath, me: str, by_key: dict[str, Person]) -> str:
    p = path.person
    who = p.name + (f", {p.role}" if p.role else "") + (f" at {p.company}" if p.company else "")
    status = f" [{p.status}]" if p.status else ""
    if path.degree == 1:
        return f"- **{who}**{status}: you know them directly."
    route = " → ".join([me, *path.chain])
    first = by_key.get(normalize_name(path.ask))
    first_status = f" (your status with them: {first.status})" if first and first.status else ""
    return f"- **{who}**{status}: ask **{path.ask}**{first_status}. Path: {route}"


def intro_report(people: list[Person], queries: list[str], me: str = "Me") -> str:
    """Markdown report covering each query (usually your target companies)."""
    by_key = {p.key: p for p in people}
    lines = [f"# Who can intro {me}?", ""]
    gaps = []
    for q in queries:
        paths = who_can_intro(people, q, me=me)
        lines.append(f"## {q}")
        if not paths:
            lines.append("- No one on your map yet. Add a contact there, or ask your groups who they know.")
            gaps.append(q)
        else:
            direct = sum(1 for x in paths if x.degree == 1)
            lines.append(f"_{len(paths)} on your map, {direct} you know directly._")
            lines.extend(_describe(x, me, by_key) for x in paths)
        lines.append("")
    if gaps:
        lines += ["## Gaps", "Targets with no one on your map: " + ", ".join(gaps), ""]
    return "\n".join(lines)
