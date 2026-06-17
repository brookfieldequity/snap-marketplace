const express = require('express');
const PDFDocument = require('pdfkit');
const sgMail = require('@sendgrid/mail');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');

const router = express.Router();

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// ── Calculator math ───────────────────────────────────────────────────────────

function agencyReplacementCalc(inputs) {
  const {
    locations,
    agencyPercent,
    primaryProviderType,
    avgHoursPerShift,
    operatingDaysPerYear,
    agencyRateOverride,
  } = inputs;

  const agencyRate =
    agencyRateOverride ||
    (primaryProviderType === 'ANESTHESIOLOGIST'
      ? 425
      : primaryProviderType === 'CRNA'
      ? 300
      : 362.5);

  const snapRate =
    primaryProviderType === 'ANESTHESIOLOGIST'
      ? 300
      : primaryProviderType === 'CRNA'
      ? 200
      : 250;

  const snapRateWithFee  = snapRate * 1.1;
  const agencyLocations  = locations * (agencyPercent / 100);

  const annualAgencySpend = agencyLocations * avgHoursPerShift * operatingDaysPerYear * agencyRate;
  const annualSnapCost    = agencyLocations * avgHoursPerShift * operatingDaysPerYear * snapRateWithFee;
  const annualSavings     = annualAgencySpend - annualSnapCost;

  return {
    annualAgencySpend,
    annualSnapCost,
    annualSavings,
    monthlySavings:  annualSavings / 12,
    fiveYearSavings: annualSavings * 5,
  };
}

function efficiencyCalc(inputs) {
  const {
    locations,
    providerCount,
    lateFilledPercent,
    avgProviderRate,
    operatingDaysPerYear,
  } = inputs;

  const totalShiftsPerYear   = locations * operatingDaysPerYear;
  const lateFilledShifts     = totalShiftsPerYear * (lateFilledPercent / 100);
  const lateSchedulingCost   = lateFilledShifts * avgProviderRate * 8 * 0.15;
  const suboptimalMixCost    = totalShiftsPerYear * avgProviderRate * 8 * 0.08;
  const optimizationSavings  = lateSchedulingCost + suboptimalMixCost;

  return {
    lateSchedulingCost,
    suboptimalMixCost,
    totalSavings:   optimizationSavings,
    monthlySavings: optimizationSavings / 12,
  };
}

// ── PDF generation ────────────────────────────────────────────────────────────

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function generatePdf(calculatorType, inputs, results, facilityName) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 50, size: 'LETTER' });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageFooter = () => {
      doc
        .fontSize(9)
        .fillColor('#888888')
        .text('Powered by StaffIQ™ | SNAP Medical', 50, doc.page.height - 40, {
          align: 'center',
          width: doc.page.width - 100,
        });
    };

    // ── Cover ──────────────────────────────────────────────────────────────────
    doc
      .fontSize(28)
      .fillColor('#1a2e4a')
      .text('StaffIQ™ Savings Report', { align: 'center' });

    doc.moveDown(0.5);

    doc
      .fontSize(16)
      .fillColor('#333333')
      .text(facilityName, { align: 'center' });

    doc.moveDown(0.5);

    doc
      .fontSize(12)
      .fillColor('#666666')
      .text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), {
        align: 'center',
      });

    doc.moveDown(2);
    pageFooter();

    // ── Section 1: Your Numbers ────────────────────────────────────────────────
    doc.addPage();

    doc.fontSize(18).fillColor('#1a2e4a').text('Section 1: Your Numbers');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#1a2e4a');
    doc.moveDown(0.5);

    doc.fontSize(11).fillColor('#333333');

    for (const [key, val] of Object.entries(inputs)) {
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
      doc.text(`${label}: ${val}`);
    }

    doc.moveDown(1);
    pageFooter();

    // ── Section 2: Your Savings ────────────────────────────────────────────────
    doc.addPage();

    doc.fontSize(18).fillColor('#1a2e4a').text('Section 2: Your Savings');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#1a2e4a');
    doc.moveDown(0.5);

    doc.fontSize(11).fillColor('#333333');

    for (const [key, val] of Object.entries(results)) {
      const label  = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
      const formatted = typeof val === 'number' ? USD.format(val) : val;
      doc.text(`${label}: ${formatted}`);
    }

    doc.moveDown(1);
    pageFooter();

    // ── Section 3: 12-Month Projection ────────────────────────────────────────
    doc.addPage();

    doc.fontSize(18).fillColor('#1a2e4a').text('Section 3: 12-Month Projection');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#1a2e4a');
    doc.moveDown(0.5);

    const monthlySavings = results.monthlySavings || 0;

    doc.fontSize(11).fillColor('#333333');

    for (let m = 1; m <= 12; m++) {
      const cumulative = monthlySavings * m;
      doc.text(`Month ${String(m).padStart(2, ' ')}: ${USD.format(cumulative)}`);
    }

    doc.moveDown(1);
    pageFooter();

    // ── Section 4: How StaffIQ Delivers These Savings ─────────────────────────
    doc.addPage();

    doc.fontSize(18).fillColor('#1a2e4a').text('Section 4: How StaffIQ Delivers These Savings');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#1a2e4a');
    doc.moveDown(0.5);

    doc.fontSize(11).fillColor('#333333').text(
      'StaffIQ™ replaces costly, reactive agency staffing with a proactive, AI-driven scheduling platform ' +
        'that matches your facility with credentialed anesthesia providers at predictable, transparent rates. ' +
        'By eliminating last-minute agency premiums and optimizing provider mix, facilities consistently achieve ' +
        'the savings modeled in this report — often within the first 90 days of deployment.',
      { lineGap: 4 }
    );

    doc.moveDown(1);
    pageFooter();

    doc.end();
  });
}

// ── POST /agency-replacement — public calculation ─────────────────────────────

router.post('/agency-replacement', async (req, res) => {
  try {
    const results = agencyReplacementCalc(req.body);
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to run agency replacement calculation' });
  }
});

// ── POST /efficiency — public calculation ─────────────────────────────────────

router.post('/efficiency', async (req, res) => {
  try {
    const results = efficiencyCalc(req.body);
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to run efficiency calculation' });
  }
});

// ── POST /generate-report — run calc, save, generate PDF, send email ──────────

router.post('/generate-report', async (req, res) => {
  try {
    const { calculatorType, inputs, facilityName, contactName, email } = req.body;

    if (!calculatorType || !inputs || !facilityName || !contactName || !email) {
      return res.status(400).json({ error: 'calculatorType, inputs, facilityName, contactName, and email are required' });
    }

    // Run the appropriate calculator
    let results;
    if (calculatorType === 'AGENCY_REPLACEMENT') {
      results = agencyReplacementCalc(inputs);
    } else if (calculatorType === 'EFFICIENCY') {
      results = efficiencyCalc(inputs);
    } else {
      return res.status(400).json({ error: 'calculatorType must be AGENCY_REPLACEMENT or EFFICIENCY' });
    }

    const totalSavings = results.annualSavings || results.totalSavings || 0;

    // Save calculator result and lead in parallel
    const [calcResult, lead] = await Promise.all([
      prisma.staffIQCalculatorResult.create({
        data: {
          calculatorType,
          facilityName,
          contactName,
          email,
          inputData:       inputs,
          outputData:      results,
          reportGenerated: false,
          reportSent:      false,
        },
      }),
      prisma.lead.create({
        data: {
          source:          'STAFFIQ_CALCULATOR',
          facilityName,
          contactName,
          email,
          calculatorType,
          savingsEstimate: totalSavings,
          followUpStatus:  'NEW',
        },
      }),
    ]);

    // Generate PDF
    const pdfBuffer = await generatePdf(calculatorType, inputs, results, facilityName);

    let reportSent = false;

    // Send email via SendGrid if configured
    if (process.env.SENDGRID_API_KEY) {
      try {
        await sgMail.send({
          to:      email,
          from:    process.env.SENDGRID_FROM_EMAIL || 'noreply@snapmedical.app',
          subject: `Your StaffIQ™ Savings Report — ${facilityName}`,
          text: `Hi ${contactName},\n\nPlease find your personalized StaffIQ™ Savings Report attached.\n\nOur team will follow up with you within 24 hours.\n\n— The SNAP Medical Team`,
          html: `<p>Hi ${contactName},</p><p>Please find your personalized StaffIQ™ Savings Report attached.</p><p>Our team will follow up with you within 24 hours.</p><p>— The SNAP Medical Team</p>`,
          attachments: [
            {
              content:     pdfBuffer.toString('base64'),
              filename:    'StaffIQ-Savings-Report.pdf',
              type:        'application/pdf',
              disposition: 'attachment',
            },
          ],
        });
        reportSent = true;
      } catch (emailErr) {
        console.error('SendGrid error (non-fatal):', emailErr);
      }
    }

    // Update records with report status
    await Promise.all([
      prisma.staffIQCalculatorResult.update({
        where: { id: calcResult.id },
        data: {
          reportGenerated: true,
          reportSent,
        },
      }),
      prisma.lead.update({
        where: { id: lead.id },
        data: {
          reportSentAt: reportSent ? new Date() : undefined,
        },
      }),
    ]);

    res.json({
      success:        true,
      savingsEstimate: totalSavings,
      message:        `Your personalized StaffIQ savings report has been sent to ${email}. Our team will follow up within 24 hours.`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// ── POST /staffiq-simple — simplified 3-input StaffIQ calculation (no auth) ───

router.post('/staffiq-simple', async (req, res) => {
  try {
    const { locations, providers, hourlyRate } = req.body;
    const loc = Number(locations);
    const rate = Number(hourlyRate);
    const hrs = 10;
    const days = 250;

    const budget = loc * rate * hrs * days;
    const inefficiency1Cost = Math.round(budget * 0.075);
    const overstaffedRooms = loc * 0.25;
    const inefficiency2Cost = Math.round(overstaffedRooms * 35 * hrs * days);
    const totalInefficiency = inefficiency1Cost + inefficiency2Cost;
    const inefficiencyPct = budget > 0 ? Math.round((totalInefficiency / budget) * 1000) / 10 : 0;

    res.json({
      budget: Math.round(budget),
      inefficiency1Cost,
      inefficiency2Cost,
      totalInefficiency,
      inefficiencyPct,
      potentialSavings: totalInefficiency,
    });
  } catch (err) {
    console.error('POST /calculator/staffiq-simple error:', err);
    res.status(500).json({ error: 'Calculation failed' });
  }
});

// ── POST /staffiq-simple/lead — save lead, generate PDF, send email ───────────

router.post('/staffiq-simple/lead', async (req, res) => {
  try {
    const { locations, providers, hourlyRate, facilityName, contactName, email, phone } = req.body;

    if (!facilityName || !contactName || !email || !locations || !hourlyRate) {
      return res.status(400).json({ error: 'facilityName, contactName, email, locations, and hourlyRate are required' });
    }

    // Run calculation
    const loc = Number(locations);
    const rate = Number(hourlyRate);
    const hrs = 10;
    const days = 250;

    const budget = loc * rate * hrs * days;
    const inefficiency1Cost = Math.round(budget * 0.075);
    const overstaffedRooms = loc * 0.25;
    const inefficiency2Cost = Math.round(overstaffedRooms * 35 * hrs * days);
    const totalInefficiency = inefficiency1Cost + inefficiency2Cost;

    // Save lead record
    const lead = await prisma.calculatorLead.create({
      data: {
        facilityName,
        contactName,
        email,
        phone: phone || null,
        locationsInput: loc,
        providersInput: Number(providers || 0),
        hourlyRateInput: rate,
        estimatedBudget: Math.round(budget),
        inefficiency1Cost,
        inefficiency2Cost,
        totalInefficiency,
        reportGenerated: false,
        followUpStatus: 'NEW',
      },
    });

    // Generate PDF in-memory
    let pdfBuffer = null;
    try {
      pdfBuffer = await generateStaffIQSimplePdf({
        facilityName,
        contactName,
        loc,
        providers: Number(providers || 0),
        rate,
        budget,
        inefficiency1Cost,
        inefficiency2Cost,
        totalInefficiency,
      });
    } catch (pdfErr) {
      console.error('PDF generation error (non-fatal):', pdfErr);
    }

    let reportSent = false;

    // Send PDF to lead + internal notification
    if (process.env.SENDGRID_API_KEY && pdfBuffer) {
      try {
        const safeFilename = `staffiq-report-${facilityName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`;

        await Promise.all([
          // Email to lead
          sgMail.send({
            to: email,
            from: process.env.SENDGRID_FROM_EMAIL || 'noreply@snapmedical.app',
            subject: `Your StaffIQ™ Savings Report — ${facilityName}`,
            text: `Hi ${contactName},\n\nThank you for using the SNAP StaffIQ calculator. Please find your personalized savings report attached.\n\nOur team will follow up with you within 24 hours to discuss how SNAP Shifts can help your facility recover these savings.\n\n— The SNAP Medical Team`,
            html: `<p>Hi ${contactName},</p><p>Thank you for using the SNAP StaffIQ calculator. Please find your personalized savings report attached.</p><p>Our team will follow up with you within 24 hours to discuss how SNAP Shifts can help your facility recover these savings.</p><p>— The SNAP Medical Team</p>`,
            attachments: [
              {
                content: pdfBuffer.toString('base64'),
                filename: safeFilename,
                type: 'application/pdf',
                disposition: 'attachment',
              },
            ],
          }),
          // Internal notification to admin
          sgMail.send({
            to: process.env.ADMIN_EMAIL || 'admin@snapmedical.com',
            from: process.env.SENDGRID_FROM_EMAIL || 'noreply@snapmedical.app',
            subject: `New StaffIQ Calculator Lead — ${facilityName}`,
            text: [
              `New StaffIQ calculator lead submitted:`,
              `Facility: ${facilityName}`,
              `Contact: ${contactName} <${email}>`,
              `Phone: ${phone || 'N/A'}`,
              `Locations: ${loc}`,
              `Providers: ${providers || 'N/A'}`,
              `Hourly Rate: $${rate}/hr`,
              `Estimated Budget: $${Math.round(budget).toLocaleString()}`,
              `Total Inefficiency Identified: $${totalInefficiency.toLocaleString()}`,
              `Lead ID: ${lead.id}`,
            ].join('\n'),
          }),
        ]);

        reportSent = true;
      } catch (emailErr) {
        console.error('SendGrid error (non-fatal):', emailErr);
      }
    }

    // Update lead record with report status
    await prisma.calculatorLead.update({
      where: { id: lead.id },
      data: {
        reportGenerated: pdfBuffer !== null,
        reportSentAt: reportSent ? new Date() : null,
      },
    });

    res.json({ success: true, email });
  } catch (err) {
    console.error('POST /calculator/staffiq-simple/lead error:', err);
    res.status(500).json({ error: 'Failed to process lead' });
  }
});

// ── PDF generator for StaffIQ Simple report ───────────────────────────────────

function generateStaffIQSimplePdf({
  facilityName,
  contactName,
  loc,
  providers,
  rate,
  budget,
  inefficiency1Cost,
  inefficiency2Cost,
  totalInefficiency,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageFooter = () => {
      doc
        .fontSize(9)
        .fillColor('#888888')
        .text('Powered by StaffIQ™ | SNAP Medical', 50, doc.page.height - 40, {
          align: 'center',
          width: doc.page.width - 100,
        });
    };

    // ── Cover ──────────────────────────────────────────────────────────────────
    doc.fontSize(28).fillColor('#1a2e4a').text('StaffIQ™ Savings Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(16).fillColor('#333333').text(facilityName, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#666666').text(
      new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      { align: 'center' }
    );
    doc.moveDown(2);
    pageFooter();

    // ── Section 1: Your Inputs ─────────────────────────────────────────────────
    doc.addPage();
    doc.fontSize(18).fillColor('#1a2e4a').text('Section 1: Your Inputs');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#1a2e4a');
    doc.moveDown(0.5);

    doc.fontSize(11).fillColor('#333333');
    doc.text(`Facility Name: ${facilityName}`);
    doc.text(`Operating Locations / ORs: ${loc}`);
    if (providers) doc.text(`Total Providers: ${providers}`);
    doc.text(`Average Hourly Rate: $${rate}/hr`);
    doc.moveDown(1);
    pageFooter();

    // ── Section 2: Your Results ────────────────────────────────────────────────
    doc.addPage();
    doc.fontSize(18).fillColor('#1a2e4a').text('Section 2: Your Results');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#1a2e4a');
    doc.moveDown(0.5);

    doc.fontSize(11).fillColor('#333333');
    doc.text(`Total Annual Staffing Budget: ${USD.format(budget)}`);
    doc.moveDown(0.5);
    doc.text(`Inefficiency #1 — Team Model Composition: ${USD.format(inefficiency1Cost)}`);
    doc.text(`Inefficiency #2 — Overstaffing to Maximum Capacity: ${USD.format(inefficiency2Cost)}`);
    doc.moveDown(0.5);
    doc.fontSize(13).fillColor('#c0392b').text(`Total Identified Inefficiency: ${USD.format(totalInefficiency)}`);
    doc.moveDown(1);
    pageFooter();

    // ── Section 3: 12-Month Savings Projection ────────────────────────────────
    doc.addPage();
    doc.fontSize(18).fillColor('#1a2e4a').text('Section 3: 12-Month Savings Projection');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#1a2e4a');
    doc.moveDown(0.5);

    const monthlySavings = totalInefficiency / 12;
    doc.fontSize(11).fillColor('#333333');
    for (let m = 1; m <= 12; m++) {
      const cumulative = monthlySavings * m;
      doc.text(`Month ${String(m).padStart(2, ' ')}: ${USD.format(cumulative)}`);
    }
    doc.moveDown(1);
    pageFooter();

    // ── Section 4: How StaffIQ Delivers These Savings ─────────────────────────
    doc.addPage();
    doc.fontSize(18).fillColor('#1a2e4a').text('Section 4: How StaffIQ Delivers These Savings');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#1a2e4a');
    doc.moveDown(0.5);

    doc.fontSize(13).fillColor('#1a2e4a').text('Inefficiency #1 — Team Model Composition');
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#333333').text(
      'Many facilities default to a 1:2 anesthesiologist-to-CRNA supervision model, leaving a third OR room ' +
      'staffed by a solo CRNA. This hybrid approach is often the most expensive model — combining the high cost ' +
      'of physician oversight with the redundancy of solo coverage. StaffIQ analyzes your current team model ' +
      'and identifies the optimal ratio based on your case mix, OR volume, and provider availability.',
      { lineGap: 4 }
    );
    doc.moveDown(0.8);

    doc.fontSize(13).fillColor('#1a2e4a').text('Inefficiency #2 — Overstaffing to Maximum Capacity');
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#333333').text(
      'Facilities consistently overstaff to their maximum OR capacity, even on days when 20-30% of rooms sit ' +
      'idle or run cases that finish early. This creates predictable overspend on per diem and agency providers ' +
      'who are not needed. StaffIQ uses historical utilization data to right-size daily staffing, reducing ' +
      'unnecessary coverage costs without impacting care delivery.',
      { lineGap: 4 }
    );
    doc.moveDown(1);
    pageFooter();

    // ── Section 5: Your Next Step ──────────────────────────────────────────────
    doc.addPage();
    doc.fontSize(18).fillColor('#1a2e4a').text('Section 5: Your Next Step');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#1a2e4a');
    doc.moveDown(0.5);

    doc.fontSize(11).fillColor('#333333').text(
      'SNAP Shifts is the anesthesia staffing platform built specifically for surgical facilities. ' +
      'Instead of reactive agency calls and last-minute scrambles, SNAP Shifts gives you a proactive scheduling ' +
      'engine that matches your facility with credentialed anesthesia providers — CRNAs and anesthesiologists — ' +
      'at transparent, predictable rates that are consistently below agency market pricing.',
      { lineGap: 4 }
    );
    doc.moveDown(0.8);
    doc.text(
      'Our team will reach out within 24 hours to walk you through a personalized demo and show you exactly ' +
      'how facilities similar to yours are recovering savings like the ones identified in this report.',
      { lineGap: 4 }
    );
    doc.moveDown(1);
    doc.fontSize(12).fillColor('#1a2e4a').text('Ready to get started? Visit snapmedical.com or reply to this email.');
    doc.moveDown(1);
    pageFooter();

    doc.end();
  });
}

module.exports = router;
