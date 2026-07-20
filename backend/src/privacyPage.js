/**
 * Privacy policy page — served at GET /privacy. Required as the App Store
 * listing's privacy URL for the SNAP marketplace app.
 * NOTE for counsel review: drafted 2026-07-18.
 */
module.exports = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Privacy Policy — SNAP Medical</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #F8FAFC; color: #0F172A; line-height: 1.65; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 40px 24px 80px; }
  .logo { font-size: 18px; font-weight: 800; color: #0066CC; margin-bottom: 6px; }
  .logo span { color: #0F172A; }
  h1 { font-size: 26px; font-weight: 800; margin: 4px 0 4px; }
  .updated { color: #64748B; font-size: 13px; margin-bottom: 28px; }
  h2 { font-size: 17px; font-weight: 800; margin: 28px 0 8px; }
  p, li { font-size: 14.5px; color: #334155; }
  ul { padding-left: 22px; }
  .card { background: #fff; border: 1px solid #E2E8F0; border-radius: 14px; padding: 24px 28px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">SNAP <span>Medical</span></div>
  <h1>Privacy Policy</h1>
  <div class="updated">SNAP Medical Technologies, LLC · Last updated July 18, 2026</div>
  <div class="card">
    <p>SNAP connects anesthesia providers with surgical facilities for shifts and scheduling. This policy explains what the SNAP app collects, why, and the control you keep over it.</p>

    <h2>What we collect</h2>
    <ul>
      <li><strong>Profile information</strong> you provide: name, specialty, years of experience, city, license details, and an optional photo and personal statement.</li>
      <li><strong>Work activity</strong>: shifts you apply to, book, and complete; your availability; schedules; earnings summaries; and ratings exchanged with facilities.</li>
      <li><strong>Location</strong> (only with your permission): used to show shifts near you. You can decline and search manually.</li>
      <li><strong>Account information</strong>: email address and, if you use them, Sign in with Apple or Google identifiers. Passwords are stored only as salted hashes.</li>
      <li><strong>Messages</strong> you exchange with facilities inside the app.</li>
    </ul>

    <h2>What we do NOT collect</h2>
    <ul>
      <li>No patient data or medical records.</li>
      <li>No advertising identifiers, no cross-app tracking, no data brokers.</li>
    </ul>

    <h2>How your information is used</h2>
    <ul>
      <li>To match you with shifts, run scheduling, and process the work you book.</li>
      <li>To show facilities you work with the profile details relevant to staffing you.</li>
      <li>To send you notifications you'd expect: schedule changes, shift offers, expiring credentials.</li>
      <li>We never sell your information.</li>
    </ul>

    <h2>How it is protected</h2>
    <ul>
      <li>Encryption in transit (TLS) everywhere; documents and files encrypted at rest.</li>
      <li>Session-backed authentication with server-side revocation.</li>
      <li>Facility users see only what their role permits.</li>
    </ul>

    <h2>Retention and deletion</h2>
    <p>Your data is retained while your account is active. You can permanently delete your account at any time from inside the app (Profile → Delete Account); this erases your profile and personal data. Records facilities are legally required to keep about completed work (e.g. payroll and staffing records) are retained by them per their obligations.</p>

    <h2>Children</h2>
    <p>SNAP is for licensed healthcare professionals and is not directed to anyone under 18.</p>

    <h2>Changes</h2>
    <p>We will post any material changes to this page and update the date above.</p>

    <h2>Contact</h2>
    <p>SNAP Medical Technologies, LLC (Massachusetts) · <a href="mailto:support@snapmedical.app">support@snapmedical.app</a></p>
  </div>
</div>
</body>
</html>`;
