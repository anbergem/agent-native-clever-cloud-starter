/**
 * The framework mounts its organization root as a prefix handler. Its final
 * POST branch creates an organization for both `/org` and unmatched tails, so
 * this policy has to run before that handler rather than only match the
 * documented root route.
 */
const ORG_PREFIX = "/_agent-native/org";

const ALLOWED_POST_PATHS = new Set([
  "/_agent-native/org/invitations",
  "/_agent-native/org/a2a-secret/sync",
  "/_agent-native/org/a2a-secret/receive",
]);

function isInvitationAcceptancePath(pathname: string): boolean {
  return /^\/_agent-native\/org\/invitations\/[^/]+\/accept\/?$/.test(pathname);
}

/**
 * Only invitations can add a signed-in person to this application's company.
 * The explicit allow-list retains the framework's legitimate POST routes while
 * denying both its documented self-create endpoint and its prefix fallback.
 */
export function blocksOrganizationSelfAdmission(
  method: string,
  pathname: string,
): boolean {
  if (method !== "POST") return false;
  if (pathname !== ORG_PREFIX && !pathname.startsWith(`${ORG_PREFIX}/`)) {
    return false;
  }
  return !(
    ALLOWED_POST_PATHS.has(pathname) || isInvitationAcceptancePath(pathname)
  );
}
