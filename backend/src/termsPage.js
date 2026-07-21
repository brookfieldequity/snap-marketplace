/**
 * Terms of Service page — served at GET /terms. Referenced by the mobile app's
 * welcome screen ("By continuing you agree to SNAP's Terms & Privacy Policy").
 * NOTE for counsel review: drafted 2026-07-21.
 */
module.exports = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Terms of Service — SNAP Medical</title>
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
  a { color: #0066CC; }
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">SNAP <span>Medical</span></div>
  <h1>Terms of Service</h1>
  <div class="updated">SNAP Medical Technologies, LLC · Last updated July 21, 2026</div>
  <div class="card">
    <p>These Terms of Service ("Terms") govern your use of the SNAP mobile application and related services (the "Service") operated by SNAP Medical Technologies, LLC ("SNAP," "we," "us"). By creating an account or using the Service, you agree to these Terms. If you do not agree, do not use the Service.</p>

    <h2>1. What SNAP is</h2>
    <p>SNAP is a software platform for anesthesia professionals. Depending on how your account is configured, the Service lets you: browse and book open shifts posted by surgical facilities (the "Marketplace"); view schedules published by practices or facilities whose roster you are on; submit availability, schedule requests, and worked hours; and communicate with facilities about shifts.</p>
    <p>SNAP is a technology platform. Unless expressly agreed otherwise in a separate written agreement, SNAP is not a staffing agency, is not your employer, and is not a party to any employment or independent-contractor relationship between you and any facility, practice, or employer of record. Facilities and practices are solely responsible for their scheduling decisions, workplace conditions, and payment obligations to you.</p>

    <h2>2. Eligibility and accounts</h2>
    <ul>
      <li>You must be at least 18 years old and a licensed or credentialed anesthesia professional (or in the process of becoming one) to use the Service.</li>
      <li>You agree to provide accurate, current, and complete information — including your name, specialty, licensure, and credential details — and to keep it up to date. Misrepresenting your identity, licensure, or credentials is grounds for immediate termination and may be reported to affected facilities.</li>
      <li>You are responsible for safeguarding your account credentials and booking PIN, and for all activity under your account. Notify us promptly of any unauthorized use.</li>
    </ul>

    <h2>3. Marketplace shifts</h2>
    <ul>
      <li>Shift listings are created by facilities. SNAP does not guarantee the availability, accuracy, or terms of any listing.</li>
      <li>Booking a shift is a commitment to the facility to work it. Cancellations and no-shows harm patient care and facility operations; repeated cancellations or no-shows may result in rating consequences, loss of platform privileges, or account termination.</li>
      <li>Some shifts require facility-specific credentialing before booking. Completing a credentialing application does not guarantee approval.</li>
    </ul>

    <h2>4. Schedules, availability, and hours</h2>
    <ul>
      <li>Schedules shown in the app are published by the practice or facility and may change. The facility's coordinator remains the authoritative source for your assignments.</li>
      <li>Availability and schedule requests you submit are shared with the relevant facility's scheduling staff.</li>
      <li>Hours you submit through the Service are records you attest to be accurate, provided to the relevant facility, practice, or its payroll processor. Compensation — including rates, timing, and method of payment — is governed by your agreement with the facility, practice, or employer of record, not by SNAP.</li>
    </ul>

    <h2>5. Acceptable use</h2>
    <p>You agree not to: use the Service for any unlawful purpose; harass or abuse facility staff or other users; post false, misleading, or defamatory content; attempt to access another user's account or data; interfere with or disrupt the Service; scrape or copy the Service or its data; or circumvent the platform to avoid fees owed by any party under a separate agreement with SNAP.</p>

    <h2>6. Communications</h2>
    <p>By providing your contact information you consent to receive transactional communications about your account, shifts, schedules, and availability by push notification, email, and SMS. Reply STOP to any SNAP SMS to opt out of text messages. See our <a href="https://api.snapmedical.app/privacy">Privacy Policy</a> for how we handle your information.</p>

    <h2>7. Content and intellectual property</h2>
    <p>The Service, including its software, design, and branding, is owned by SNAP and its licensors. You retain ownership of the content you submit (such as your profile and messages) and grant SNAP a license to use it as needed to operate and improve the Service. You may not use SNAP's name or branding without our written permission.</p>

    <h2>8. Disclaimers</h2>
    <p>The Service is provided "as is" and "as available," without warranties of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, and non-infringement. SNAP does not warrant that the Service will be uninterrupted or error-free, and is not responsible for the acts or omissions of facilities, practices, employers of record, or other users.</p>

    <h2>9. Limitation of liability</h2>
    <p>To the maximum extent permitted by law, SNAP will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for lost profits, wages, or data, arising out of or relating to your use of the Service. SNAP's total liability for any claim arising out of these Terms or the Service will not exceed the greater of one hundred dollars ($100) or the amounts you paid SNAP in the twelve months before the claim arose.</p>

    <h2>10. Termination</h2>
    <p>You may stop using the Service and delete your account at any time from the Profile screen. We may suspend or terminate your access at any time for violation of these Terms, misrepresentation of credentials, conduct that endangers patient care, or as required by law. Sections 7–9 and 11–12 survive termination.</p>

    <h2>11. Changes to these Terms</h2>
    <p>We may update these Terms from time to time. If we make material changes, we will notify you through the app or by email before the changes take effect. Continued use of the Service after changes take effect constitutes acceptance of the updated Terms.</p>

    <h2>12. Governing law</h2>
    <p>These Terms are governed by the laws of the Commonwealth of Massachusetts, without regard to its conflict-of-laws rules. Any dispute arising out of these Terms or the Service will be brought in the state or federal courts located in Massachusetts, and you consent to their jurisdiction.</p>

    <h2>Contact</h2>
    <p>Questions about these Terms: <a href="mailto:support@snapmedical.app">support@snapmedical.app</a>.</p>
  </div>
</div>
</body>
</html>`;
