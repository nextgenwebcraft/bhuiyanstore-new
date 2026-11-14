-- D109: the rate a DSR sheet's damaged pieces are stored at. Null on a line with no damage,
-- and on damage entered before this column (the engine then uses the line's sale price).
ALTER TABLE "dsr_line" ADD COLUMN "damage_rate" DECIMAL(20,6);
