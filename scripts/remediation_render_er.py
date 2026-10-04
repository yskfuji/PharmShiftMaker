"""Render actual database metadata locally; diagram contains no staff data."""

import html
import json
import subprocess
import sys
from pathlib import Path


def main():
    directory = Path(sys.argv[1])
    schema = json.loads((directory / "physical-schema.json").read_text())
    output = directory / "rendered"
    output.mkdir(exist_ok=False)
    tables = schema["tables"]
    groups = {
        "planning": {name for name in tables if name.startswith("planning_")},
        "compliance": {
            name
            for name in tables
            if name not in {"alembic_version"}
            and not name.startswith("planning_")
            and name
            not in {
                "people",
                "profiles",
                "staff_timeline",
                "holiday_requests",
                "leave_quotas",
                "schedules",
                "schedule_assignments",
            }
        },
        "legacy": {
            "people",
            "profiles",
            "staff_timeline",
            "holiday_requests",
            "leave_quotas",
            "schedules",
            "schedule_assignments",
        },
    }
    groups = {name: names & tables.keys() for name, names in groups.items()}
    groups = {name: names for name, names in groups.items() if names}
    for group, names in groups.items():
        lines = [
            "digraph schema {",
            'graph [rankdir=LR, bgcolor="white", pad="0.25", nodesep="0.45", ranksep="1.0"];',
            'node [shape=plain,fontname="Helvetica"];',
            'edge [fontname="Helvetica", fontsize=9, color="#475569"];',
        ]
        for name in sorted(names):
            table = tables[name]
            pk = set(table["primary_key"]["constrained_columns"])
            cells = [
                f'<TR><TD COLSPAN="3" BGCOLOR="#dbeafe"><B>{html.escape(name)}</B></TD></TR>'
            ]
            for col in table["columns"]:
                key = "PK" if col["name"] in pk else ""
                if any(
                    col["name"] in fk["constrained_columns"]
                    for fk in table["foreign_keys"]
                ):
                    key += " FK"
                cells.append(
                    f'<TR><TD ALIGN="LEFT">{html.escape(col["name"])}</TD><TD ALIGN="LEFT">{html.escape(col["type"])}</TD><TD>{key} {"NULL" if col["nullable"] else "NOT NULL"}</TD></TR>'
                )
            lines.append(
                f'"{name}" [label=<<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="0" CELLPADDING="4">'
                + "".join(cells)
                + "</TABLE>>];"
            )
        outside = set()
        for name in sorted(names):
            for fk in tables[name]["foreign_keys"]:
                parent = fk["referred_table"]
                if parent not in names and parent not in outside:
                    lines.append(
                        f'"{parent}" [shape=box,style=dashed,label="{parent} (other diagram)"];'
                    )
                    outside.add(parent)
                label = (
                    ", ".join(fk["constrained_columns"])
                    + " -> "
                    + ", ".join(fk["referred_columns"])
                )
                lines.append(
                    f'"{name}" -> "{parent}" [label={json.dumps(label)},arrowhead=normal];'
                )
        lines.append("}")
        source = output / (group + ".dot")
        source.write_text("\n".join(lines))
        for fmt in ["svg", "png"]:
            subprocess.run(
                [
                    "dot",
                    "-T" + fmt,
                    str(source),
                    "-o",
                    str(output / (group + "." + fmt)),
                ],
                check=True,
            )
    (output / "README.md").write_text(
        "# Physical database diagrams\n\nGenerated locally from `../physical-schema.json`; arrows are actual foreign keys, not logical JSON links. Dashed boxes denote tables shown in another diagram. Composite UNIQUE, CHECK, server defaults and indexes remain in the JSON catalogue. A foreign key does not establish an authorization boundary or cascade permission.\n\n"
        + "\n".join(f"- [{name}](./{name}.svg)" for name in groups)
        + "\n\nSchema hash: `"
        + schema["schema_hash"]
        + "`.\n"
    )
    print(output)


if __name__ == "__main__":
    main()
