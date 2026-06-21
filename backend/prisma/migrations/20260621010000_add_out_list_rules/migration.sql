-- Out-List Builder: admin-configured rule set for one-click release-order
-- generation. JSON blob { lateSites, lateSiteNoCloseAdjacent,
-- closerFirstOutNextDay, noBackToBackClosing }. Additive/nullable; applied in
-- prod via db push. See services/outListRules.js + schedule-builder-todos.
ALTER TABLE "Facility" ADD COLUMN "outListRules" JSONB;
