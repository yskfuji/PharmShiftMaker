"""Operator-only control recovery; never infer an application rollback from a timeout.

This tool operates only the separately authenticated control service. It does not
stop application DB sessions or prove absence of a business commit. Consequently
it deliberately offers no automatic verified-rollback command.
"""

import argparse
import json
import os

from shift_scheduler.control.client import AuthorityClient


def run(client, args):
    if args.action == "reconcile-witness":
        return client.request("POST", "/witness/reconcile")
    if args.action == "fence-writer":
        return client.request(
            "POST",
            "/nodes/" + args.node + "/fence",
            {
                "operation_id": args.operation_id,
                "expected_generation": args.generation,
                "reason": args.reason,
            },
        )
    if args.action == "replace-writer":
        return client.request(
            "POST",
            "/nodes/" + args.node + "/replace-writer",
            {
                "fence_id": args.fence_id,
                "expected_generation": args.generation,
                "new_node_id": args.new_node,
            },
        )
    raise ValueError("Unsupported maintenance action")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("reconcile-witness")
    fence = commands.add_parser("fence-writer")
    fence.add_argument("--node", required=True)
    fence.add_argument("--operation-id", required=True)
    fence.add_argument("--generation", required=True, type=int)
    fence.add_argument("--reason", required=True)
    replace = commands.add_parser("replace-writer")
    replace.add_argument("--node", required=True)
    replace.add_argument("--new-node", required=True)
    replace.add_argument("--fence-id", required=True)
    replace.add_argument("--generation", required=True, type=int)
    client = AuthorityClient(
        os.environ["PHARMSHIFT_CONTROL_URL"],
        os.environ["PHARMSHIFT_CONTROL_OPERATOR_ID"],
        os.environ["PHARMSHIFT_CONTROL_OPERATOR_TOKEN"],
        os.environ["PHARMSHIFT_CONTROL_PUBLIC_KEY"],
    )
    print(json.dumps(run(client, parser.parse_args()), ensure_ascii=False))


if __name__ == "__main__":
    main()
