-- SchoolFunder — student-earned tuition assistance program (Faith Foundation
-- program / Benavora showcase feature). Idempotent per repo convention.
-- NOT YET APPLIED to the live database as of this migration file's creation —
-- apply manually via the Supabase SQL editor or Management API. See STATE_OF_THE_BUILD.md.

CREATE TABLE IF NOT EXISTS schoolfunder_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  school_name text,
  grade_level text,
  enrollment_year integer,
  target_tuition_amount numeric,
  funded_amount numeric DEFAULT 0,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schoolfunder_volunteer_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES schoolfunder_students(id),
  org_id uuid NOT NULL REFERENCES organizations(id),
  hours numeric NOT NULL,
  activity_description text,
  verified boolean DEFAULT false,
  verified_by uuid REFERENCES profiles(id),
  hour_value numeric DEFAULT 25,
  logged_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schoolfunder_donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  student_id uuid REFERENCES schoolfunder_students(id),
  donor_name text,
  donor_email text,
  amount numeric NOT NULL,
  payment_status text DEFAULT 'pending',
  stripe_payment_intent_id text,
  institution_name text,
  institution_routing_number text,
  disbursed boolean DEFAULT false,
  disbursed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schoolfunder_students_org ON schoolfunder_students(org_id);
CREATE INDEX IF NOT EXISTS idx_schoolfunder_volunteer_hours_org ON schoolfunder_volunteer_hours(org_id);
CREATE INDEX IF NOT EXISTS idx_schoolfunder_volunteer_hours_student ON schoolfunder_volunteer_hours(student_id);
CREATE INDEX IF NOT EXISTS idx_schoolfunder_donations_org ON schoolfunder_donations(org_id);
CREATE INDEX IF NOT EXISTS idx_schoolfunder_donations_student ON schoolfunder_donations(student_id);

ALTER TABLE schoolfunder_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolfunder_volunteer_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolfunder_donations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schoolfunder_students_org_isolation" ON schoolfunder_students;
CREATE POLICY "schoolfunder_students_org_isolation" ON schoolfunder_students
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "schoolfunder_volunteer_hours_org_isolation" ON schoolfunder_volunteer_hours;
CREATE POLICY "schoolfunder_volunteer_hours_org_isolation" ON schoolfunder_volunteer_hours
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "schoolfunder_donations_org_isolation" ON schoolfunder_donations;
CREATE POLICY "schoolfunder_donations_org_isolation" ON schoolfunder_donations
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
