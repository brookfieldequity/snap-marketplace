-- Out-List Builder: per-day release order (who leaves first → who closes).
-- ScheduleAssignment.outRank = manual release rank (lower leaves first);
-- ScheduleDay.outListPublishedAt = when the out-list was published for that
-- facility/date/location (the floor-runner order only shows once set).
-- Additive/nullable; applied in prod via db push. See schedule-builder-todos.
ALTER TABLE "ScheduleAssignment" ADD COLUMN "outRank" INTEGER;
ALTER TABLE "ScheduleDay" ADD COLUMN "outListPublishedAt" TIMESTAMP(3);
