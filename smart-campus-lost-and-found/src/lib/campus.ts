// Only emails from this domain (and its subdomains, like khi.iba.edu.pk) can sign up.
// Leave empty to accept any email address.
export const CAMPUS_EMAIL_DOMAIN: string = "iba.edu.pk";

export function isCampusEmail(email: string) {
  if (!CAMPUS_EMAIL_DOMAIN) return true;
  const host = email.trim().toLowerCase().split("@")[1] ?? "";
  const domain = CAMPUS_EMAIL_DOMAIN.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

// Max matches shown per lost item on the dashboard.
export const MATCHES_PER_ITEM = 3;
