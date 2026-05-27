-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PROVIDER', 'FACILITY_USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "Specialty" AS ENUM ('CRNA', 'ANESTHESIOLOGIST', 'ANESTHESIA_ASSISTANT');

-- CreateEnum
CREATE TYPE "NotifPreference" AS ENUM ('IMMEDIATE', 'DAILY_DIGEST', 'WEEKLY_SUMMARY', 'NONE');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('BASIC', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('DEPOSIT_PENDING', 'LIVE', 'FILLED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VIPReason" AS ENUM ('DAILY_LOGIN', 'CALENDAR_UPDATED', 'SHIFT_ACCEPTED', 'SHIFT_COMPLETED', 'HIGH_RATING');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'PROVIDER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "specialty" "Specialty",
    "additionalSpecialties" "Specialty"[],
    "yearsExperience" INTEGER,
    "city" TEXT,
    "state" TEXT NOT NULL DEFAULT 'MA',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "photoUrl" TEXT,
    "pin" TEXT,
    "credentialed" BOOLEAN NOT NULL DEFAULT false,
    "maLicenseNumber" TEXT,
    "maLicenseExpiry" TIMESTAMP(3),
    "maLicenseAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "personalStatement" TEXT,
    "equipmentPreferences" TEXT,
    "caseMixExperience" TEXT,
    "vipPoints" INTEGER NOT NULL DEFAULT 0,
    "vipStatus" BOOLEAN NOT NULL DEFAULT false,
    "vipEarnedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "notifPreference" "NotifPreference" NOT NULL DEFAULT 'IMMEDIATE',
    "notifSurge" BOOLEAN NOT NULL DEFAULT true,
    "expoPushToken" TEXT,
    "profileCompletePct" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "facilityType" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT NOT NULL DEFAULT 'MA',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "photoUrls" TEXT[],
    "description" TEXT,
    "caseMix" TEXT,
    "parking" TEXT,
    "whatToBring" TEXT,
    "profileScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityUser" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "facilityRole" TEXT NOT NULL DEFAULT 'SCHEDULER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilitySubscription" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL DEFAULT 'BASIC',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "shiftsPostedThisMonth" INTEGER NOT NULL DEFAULT 0,
    "monthResetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilitySubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "specialty" "Specialty" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "durationHours" DOUBLE PRECISION NOT NULL,
    "baseRate" DOUBLE PRECISION NOT NULL,
    "currentRate" DOUBLE PRECISION NOT NULL,
    "surgeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "surgeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "status" "ShiftStatus" NOT NULL DEFAULT 'DEPOSIT_PENDING',
    "preferredAccessOnly" BOOLEAN NOT NULL DEFAULT false,
    "preferredWindowEnds" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "currentViewers" INTEGER NOT NULL DEFAULT 0,
    "estimatedTotal" DOUBLE PRECISION,
    "depositAmount" DOUBLE PRECISION,
    "depositConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "depositConfirmedAt" TIMESTAMP(3),
    "platformFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "platformFeeAmount" DOUBLE PRECISION,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentSettledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftApplication" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ShiftApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftBooking" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerHourlyRate" DOUBLE PRECISION,
    "shiftDurationHours" DOUBLE PRECISION,
    "totalShiftValue" DOUBLE PRECISION,
    "platformFeePercent" DOUBLE PRECISION,
    "platformFeeAmount" DOUBLE PRECISION,
    "facilityTier" "SubscriptionTier",
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftCompletion" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "providerHours" DOUBLE PRECISION,
    "providerNotes" TEXT,
    "providerConfirmedAt" TIMESTAMP(3),
    "facilityConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "facilityHours" DOUBLE PRECISION,
    "facilityNotes" TEXT,
    "facilityConfirmedAt" TIMESTAMP(3),
    "disputed" BOOLEAN NOT NULL DEFAULT false,
    "disputeResolvedAt" TIMESTAMP(3),
    "disputeNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAvailability" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "available" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderRating" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityRating" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferredProvider" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreferredProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VIPPointsLog" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" "VIPReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VIPPointsLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderProfile_userId_key" ON "ProviderProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityUser_userId_facilityId_key" ON "FacilityUser"("userId", "facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "FacilitySubscription_facilityId_key" ON "FacilitySubscription"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftApplication_shiftId_providerId_key" ON "ShiftApplication"("shiftId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftBooking_shiftId_key" ON "ShiftBooking"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftCompletion_bookingId_key" ON "ShiftCompletion"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAvailability_providerId_date_key" ON "ProviderAvailability"("providerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderRating_bookingId_key" ON "ProviderRating"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityRating_bookingId_key" ON "FacilityRating"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "PreferredProvider_facilityId_providerId_key" ON "PreferredProvider"("facilityId", "providerId");

-- AddForeignKey
ALTER TABLE "ProviderProfile" ADD CONSTRAINT "ProviderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityUser" ADD CONSTRAINT "FacilityUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityUser" ADD CONSTRAINT "FacilityUser_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySubscription" ADD CONSTRAINT "FacilitySubscription_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftApplication" ADD CONSTRAINT "ShiftApplication_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftApplication" ADD CONSTRAINT "ShiftApplication_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftBooking" ADD CONSTRAINT "ShiftBooking_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftBooking" ADD CONSTRAINT "ShiftBooking_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCompletion" ADD CONSTRAINT "ShiftCompletion_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCompletion" ADD CONSTRAINT "ShiftCompletion_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ShiftBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCompletion" ADD CONSTRAINT "ShiftCompletion_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAvailability" ADD CONSTRAINT "ProviderAvailability_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRating" ADD CONSTRAINT "ProviderRating_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRating" ADD CONSTRAINT "ProviderRating_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRating" ADD CONSTRAINT "ProviderRating_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ShiftBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityRating" ADD CONSTRAINT "FacilityRating_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityRating" ADD CONSTRAINT "FacilityRating_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityRating" ADD CONSTRAINT "FacilityRating_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ShiftBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferredProvider" ADD CONSTRAINT "PreferredProvider_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferredProvider" ADD CONSTRAINT "PreferredProvider_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VIPPointsLog" ADD CONSTRAINT "VIPPointsLog_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
