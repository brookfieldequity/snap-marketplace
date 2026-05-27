/*
  Warnings:

  - You are about to drop the column `city` on the `Facility` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Facility" DROP COLUMN "city",
ADD COLUMN     "zipCode" TEXT;
