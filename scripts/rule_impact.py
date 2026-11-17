"""List what a revised rule source affects (G04), without writing anything.

Usage:
  python scripts/rule_impact.py --scope hospital/pharmacy --review-id REVIEW [--source FILE]

Prints the publications, grant assessments and grant records decided under an
earlier rule revision within the review's interval, with the impact hash to
record in the publish/hold decision. With --source, the file's SHA-256 is
compared with the one bound in the review. The database is the configured
application database (SHIFT_SCHEDULER_DB_URL); the session is rolled back.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--scope", required=True, help="facility/department")
    parser.add_argument("--review-id", required=True)
    parser.add_argument("--source", type=Path, help="the downloaded source document")
    args = parser.parse_args(argv)

    from shift_scheduler.application.compliance import entity_key
    from shift_scheduler.application.rule_impact import rule_impact
    from shift_scheduler.db.compliance_models import ComplianceEntity
    from shift_scheduler.db.session import get_session_factory
    from shift_scheduler.domain.compliance_v3 import RuleReview

    session = get_session_factory()()
    try:
        row = session.get(
            ComplianceEntity, entity_key(args.scope, "rule_review", args.review_id)
        )
        if row is None:
            print("制度確認が見つかりません。", file=sys.stderr)
            return 2
        review = RuleReview.model_validate(row.payload)
        result = rule_impact(session, args.scope, review)
    finally:
        session.rollback()
        session.close()
    if args.source is not None:
        actual = sha256(args.source)
        result["source_file_sha256"] = actual
        result["source_matches_review"] = actual == review.source_sha256
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if result.get("source_matches_review", True) else 1


if __name__ == "__main__":
    raise SystemExit(main())
