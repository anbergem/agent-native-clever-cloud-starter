import { registerIdentityColumns } from "@agent-native/core/org";
import { defineNitroPlugin } from "@agent-native/core/server";

/**
 * How this app's own email-shaped columns behave when a member changes their email or is
 * removed from an organization (framework 0.181 member offboarding).
 *
 * The framework scans every table for identity-shaped columns and refuses to remove a member
 * — HTTP 503, "local cleanup is pending" — until each one has a declared policy, so this file
 * is what makes removing a member work at all. It is named `db.ts` because the framework's
 * `agent-native identity rekey` CLI reads declarations from exactly this module.
 *
 * Every policy is scoped to `org_id`: removing someone from one organization never touches
 * another organization's rows.
 */
registerIdentityColumns([
  {
    table: "customers",
    column: "email",
    emailChange: "retain",
    offboard: "retain",
    orgScope: { column: "org_id" },
    reason:
      "A customer's own contact address, not an app user. A member changing their email or leaving must never rewrite it, even if the two addresses happen to match.",
  },
  {
    table: "customers",
    column: "created_by",
    emailChange: "rekey",
    offboard: "retain",
    orgScope: { column: "org_id" },
    reason:
      "Attribution: who created the customer. It follows the person to a new address, and stays theirs when they leave — handing it to a successor would rewrite history. It grants no access.",
  },
  {
    table: "jobs",
    column: "created_by",
    emailChange: "rekey",
    offboard: "retain",
    orgScope: { column: "org_id" },
    reason:
      "Attribution: who created the job, as for customers.created_by. Open work is reassigned by hand (docs/runbook.md), not by rewriting who created it.",
  },
]);

// Declarations happen at module load; the plugin itself has nothing to do.
export default defineNitroPlugin(() => {});
