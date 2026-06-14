__BENAVORA__

Schema Registry v2\.0

58 Tables | 15 New for Tier 6

June 13, 2026

# __1\. New Enum Types \(Tier 6 Additions\)__

These extend the existing enums from Schema Registry v1\.

CREATE TYPE automation\_level AS ENUM \('supervised', 'semi\_autonomous', 'autonomous'\);

CREATE TYPE automation\_status AS ENUM \('queued', 'processing', 'paused', 'completed', 'failed'\);

CREATE TYPE integration\_service AS ENUM \('sam\_gov', 'two\_captcha', 'candid', 'gmail', 'gcal', 'resend', 'custom\_api'\);

CREATE TYPE follow\_up\_type AS ENUM \('check\_in', 'thank\_you', 'feedback\_request', 'renewal\_prep'\);

CREATE TYPE follow\_up\_channel AS ENUM \('email', 'linkedin', 'phone', 'mail'\);

CREATE TYPE obligation\_type AS ENUM \('reporting', 'spending\_restriction', 'matching\_fund', 'regulatory'\);

CREATE TYPE obligation\_status AS ENUM \('pending', 'completed', 'overdue'\);

CREATE TYPE notification\_channel AS ENUM \('in\_app', 'email'\);

CREATE TYPE scrape\_schedule AS ENUM \('hourly', 'daily', 'weekly', 'monthly'\);

CREATE TYPE api\_auth\_type AS ENUM \('none', 'api\_key', 'bearer', 'oauth'\);

Add to existing agent\_type enum:

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'grants\_gov\_research';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'sam\_gov\_research';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'propublica\_mining';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'state\_portal\_research';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'custom\_api\_research';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'custom\_scrape\_research';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'giving\_history\_extractor';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'success\_probability';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'funder\_relationship';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'competitor\_intelligence';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'deadline\_prediction';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'application\_cloning';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'semantic\_matching';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'follow\_up\_generator';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'automation\_worker';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'csv\_import';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'notification\_dispatcher';

ALTER TYPE agent\_type ADD VALUE IF NOT EXISTS 'financial\_reconciliation';

# __2\. New Tables \(44\-58\)__

All tables follow the RLS master pattern: organization\_id = \(SELECT organization\_id FROM profiles WHERE id = auth\.uid\(\)\)\. Exception: state\_portals is a shared admin\-managed config table\.

## __44\. automation\_queue__

Batch processing queue for browser automation submissions\.

CREATE TABLE automation\_queue \(

  id uuid PRIMARY KEY DEFAULT gen\_random\_uuid\(\),

  organization\_id uuid NOT NULL REFERENCES organizations\(id\),

  application\_id uuid NOT NULL REFERENCES applications\(id\) ON DELETE CASCADE,

  priority integer NOT NULL DEFAULT 3 CHECK \(priority >= 1 AND priority <= 5\),

  status automation\_status NOT NULL DEFAULT 'queued',

  automation\_level automation\_level NOT NULL DEFAULT 'supervised',

  retry\_count integer DEFAULT 0,

  max\_retries integer DEFAULT 3,

  error\_log jsonb DEFAULT '\[\]',

  worker\_id text,

  created\_at timestamptz DEFAULT now\(\),

  started\_at timestamptz,

  completed\_at timestamptz

\);

ALTER TABLE automation\_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "automation\_queue\_org" ON automation\_queue USING \(organization\_id = \(SELECT organization\_id FROM profiles WHERE id = auth\.uid\(\)\)\);

CREATE INDEX idx\_auto\_queue\_org ON automation\_queue\(organization\_id\);

CREATE INDEX idx\_auto\_queue\_status ON automation\_queue\(status\);

CREATE INDEX idx\_auto\_queue\_priority ON automation\_queue\(priority DESC, created\_at ASC\);

## __45\. state\_portals__

Configuration for state grant portal scraping\. NOT org\-scoped \(shared resource\)\.

CREATE TABLE state\_portals \(

  id uuid PRIMARY KEY DEFAULT gen\_random\_uuid\(\),

  state\_code text NOT NULL UNIQUE,

  state\_name text NOT NULL,

  portal\_url text NOT NULL,

  scraping\_strategy jsonb DEFAULT '\{\}',

  is\_active boolean DEFAULT true,

  last\_scraped\_at timestamptz,

  last\_success\_at timestamptz,

  error\_count integer DEFAULT 0,

  created\_at timestamptz DEFAULT now\(\),

  updated\_at timestamptz DEFAULT now\(\)

\);

\-\- No RLS: shared config table, admin\-managed

CREATE INDEX idx\_state\_portals\_code ON state\_portals\(state\_code\);

## __46\. funder\_giving\_history__

Extracted from IRS 990\-PF Schedule I filings via ProPublica\.

CREATE TABLE funder\_giving\_history \(

  id uuid PRIMARY KEY DEFAULT gen\_random\_uuid\(\),

  organization\_id uuid NOT NULL REFERENCES organizations\(id\),

  funder\_id uuid NOT NULL REFERENCES funders\(id\) ON DELETE CASCADE,

  recipient\_name text NOT NULL,

  recipient\_ein text,

  amount numeric\(12,2\),

  purpose text,

  fiscal\_year integer NOT NULL,

  source\_filing\_url text,

  created\_at timestamptz DEFAULT now\(\)

\);

ALTER TABLE funder\_giving\_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "funder\_giving\_history\_org" ON funder\_giving\_history USING \(organization\_id = \(SELECT organization\_id FROM profiles WHERE id = auth\.uid\(\)\)\);

CREATE INDEX idx\_giving\_hist\_org ON funder\_giving\_history\(organization\_id\);

CREATE INDEX idx\_giving\_hist\_funder ON funder\_giving\_history\(funder\_id\);

CREATE INDEX idx\_giving\_hist\_year ON funder\_giving\_history\(fiscal\_year DESC\);

CREATE UNIQUE INDEX idx\_giving\_hist\_dedup ON funder\_giving\_history\(funder\_id, recipient\_ein, fiscal\_year, amount\);

## __47\. integration\_keys__

Encrypted API key storage for client\-connected services\.

CREATE TABLE integration\_keys \(

  id uuid PRIMARY KEY DEFAULT gen\_random\_uuid\(\),

  organization\_id uuid NOT NULL REFERENCES organizations\(id\),

  service\_name integration\_service NOT NULL,

  encrypted\_key text NOT NULL,

  is\_active boolean DEFAULT true,

  last\_validated\_at timestamptz,

  validation\_status text DEFAULT 'pending',

  created\_at timestamptz DEFAULT now\(\),

  updated\_at timestamptz DEFAULT now\(\),

  UNIQUE\(organization\_id, service\_name\)

\);

ALTER TABLE integration\_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "integration\_keys\_org" ON integration\_keys USING \(organization\_id = \(SELECT organization\_id FROM profiles WHERE id = auth\.uid\(\)\)\);

CREATE INDEX idx\_integ\_keys\_org ON integration\_keys\(organization\_id\);

## __48\. custom\_api\_connections__

Client\-configured REST API integrations for opportunity discovery\.

CREATE TABLE custom\_api\_connections \(

  id uuid PRIMARY KEY DEFAULT gen\_random\_uuid\(\),

  organization\_id uuid NOT NULL REFERENCES organizations\(id\),

  name text NOT NULL,

  base\_url text NOT NULL,

  auth\_type api\_auth\_type NOT NULL DEFAULT 'none',

  auth\_config jsonb DEFAULT '\{\}',

  field\_mapping jsonb NOT NULL DEFAULT '\{\}',

  poll\_schedule scrape\_schedule NOT NULL DEFAULT 'daily',

  is\_active boolean DEFAULT true,

  last\_polled\_at timestamptz,

  last\_success\_at timestamptz,

  error\_count integer DEFAULT 0,

  created\_at timestamptz DEFAULT now\(\),

  updated\_at timestamptz DEFAULT now\(\)

\);

ALTER TABLE custom\_api\_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custom\_api\_org" ON custom\_api\_connections USING \(organization\_id = \(SELECT organization\_id FROM profiles WHERE id = auth\.uid\(\)\)\);

CREATE INDEX idx\_custom\_api\_org ON custom\_api\_connections\(organization\_id\);

## __49\. scraping\_targets__

Client\-assigned URLs for scheduled AI\-powered web scraping\.

CREATE TABLE scraping\_targets \(

  id uuid PRIMARY KEY DEFAULT gen\_random\_uuid\(\),

  organization\_id uuid NOT NULL REFERENCES organizations\(id\),

  url text NOT NULL,

  description text,

  scrape\_schedule scrape\_schedule NOT NULL DEFAULT 'weekly',

  last\_scraped\_at timestamptz,

  last\_success\_at timestamptz,

  failure\_count integer DEFAULT 0,

  is\_active boolean DEFAULT true,

  created\_at timestamptz DEFAULT now\(\),

  updated\_at timestamptz DEFAULT now\(\)

\);

ALTER TABLE scraping\_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scraping\_targets\_org" ON scraping\_targets USING \(organization\_id = \(SELECT organization\_id FROM profiles WHERE id = auth\.uid\(\)\)\);

CREATE INDEX idx\_scrape\_targets\_org ON scraping\_targets\(organization\_id\);

## __50\. funder\_relationship\_scores__

Dynamic relationship trajectory tracking per funder\.

CREATE TABLE funder\_relationship\_scores \(

  id uuid PRIMARY KEY DEFAULT gen\_random\_uuid\(\),

  organization\_id uuid NOT NULL REFERENCES organizations\(id\),

  funder\_id uuid NOT NULL REFERENCES funders\(id\) ON DELETE CASCADE,

  score integer NOT NULL DEFAULT 0,

  events jsonb DEFAULT '\[\]',

  trend text DEFAULT 'neutral',

  last\_updated\_at timestamptz DEFAULT now\(\),

  created\_at timestamptz DEFAULT now\(\),

  UNIQUE\(organization\_id, funder\_id\)

\);

ALTER TABLE funder\_relationship\_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "funder\_rel\_scores\_org" ON funder\_relationship\_scores USING \(organization\_id = \(SELECT organization\_id FROM profiles WHERE id = auth\.uid\(\)\)\);

CREATE INDEX idx\_funder\_rel\_org ON funder\_relationship\_scores\(organization\_id\);

CREATE INDEX idx\_funder\_rel\_score ON funder\_relationship\_scores\(score DESC\);

## __51\. success\_probability\_scores__

Per\-application success prediction with factor breakdown\.

CREATE TABLE success\_probability\_scores \(

  id uuid PRIMARY KEY DEFAULT gen\_random\_uuid\(\),

  organization\_id uuid NOT NULL REFERENCES organizations\(id\),

  application\_id uuid NOT NULL REFERENCES applications\(id\) ON DELETE CASCADE,

  probability\_score integer NOT NULL CHECK \(probability\_score >= 0 AND probability\_score <= 100\),

  factors jsonb NOT NULL DEFAULT '\{\}',

  calculated\_at timestamptz DEFAULT now\(\),

  UNIQUE\(organization\_id, application\_id\)

\);

ALTER TABLE success\_probability\_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "success\_prob\_org" ON success\_probability\_scores USING \(organization\_id = \(SELECT organization\_id FROM profiles WHERE id = auth\.uid\(\)\)\);

CREATE INDEX idx\_success\_prob\_org ON success\_probability\_scores\(organization\_id\);

CREATE INDEX idx\_success\_prob\_score ON success\_probability\_scores\(probability\_score DESC\);

## __52\. competitor\_tracking__

Organizations funded by target funders, extracted from 990 data\.

CREATE TABLE competitor\_tracking \(

  id uuid PRIMARY KEY DEFAULT gen\_random\_uuid\(\),

  organization\_id uuid NOT NULL REFERENCES organizations\(id\),

  competitor\_name text NOT NULL,

  competitor\_ein text,

  funder\_id uuid REFERENCES funders\(id\) ON DELETE CASCADE,

  grant\_amount numeric\(12,2\),

  grant\_purpose text,

  fiscal\_year integer,

  source text,

  created\_at timestamptz DEFAULT now\(\)

\);

ALTER TABLE competitor\_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "competitor\_org" ON competitor\_tracking USING \(organization\_id = \(SELECT organization\_id FROM profiles WHERE id = auth\.uid\(\)\)\);

CREATE INDEX idx\_competitor\_org ON competitor\_tracking\(organization\_id\);

CREATE INDEX idx\_competitor\_funder ON competitor\_tracking\(funder\_id\);

## __53\. follow\_up\_sequences__

Auto\-generated post\-submission actions across channels\.

CREATE TABLE follow\_up\_sequences \(

  id uuid PRIMARY KEY DEFAULT gen\_random\_uuid\(\),

  organization\_id uuid NOT NULL REFERENCES organizations\(id\),

  application\_id uuid NOT NULL REFERENCES applications\(id\) ON DELETE CASCADE,

  sequence\_type follow\_up\_type NOT NULL,

  scheduled\_date date NOT NULL,

  status text DEFAULT 'pending',

  content text,

  channel follow\_up\_channel NOT NULL DEFAULT 'email',

  sent\_at timestamptz,

  created\_at timestamptz DEFAULT now\(\)

\);

ALTER TABLE follow\_up\_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follow\_up\_org" ON follow\_up\_sequences USING \(organization\_id = \(SELECT organization\_id FROM profiles WHERE id = auth\.uid\(\)\)\);

CREATE INDEX idx\_follow\_up\_org ON follow\_up\_sequences\(organization\_id\);

CREATE INDEX idx\_follow\_up\_date ON follow\_up\_sequences\(scheduled\_date\);

CREATE INDEX idx\_follow\_up\_status ON follow\_up\_sequences\(status\);

## __54\. grant\_financials__

End\-to\-end financial tracking per grant: requested, awarded, received, spent\.

CREATE TABLE grant\_financials \(

  id uuid PRIMARY KEY DEFAULT gen\_random\_uuid\(\),

  organization\_id uuid NOT NULL REFERENCES organizations\(id\),

  application\_id uuid NOT NULL REFERENCES applications\(id\) ON DELETE CASCADE,

  amount\_requested numeric\(12,2\),

  amount\_awarded numeric\(12,2\),

  amount\_received numeric\(12,2\) DEFAULT 0,

  amount\_spent numeric\(12,2\) DEFAULT 0,

  budget\_categories jsonb DEFAULT '\{\}',

  reporting\_status text DEFAULT 'not\_required',

  next\_report\_due date,

  created\_at timestamptz DEFAULT now\(\),

  updated\_at timestamptz DEFAULT now\(\),

  UNIQUE\(organization\_id, application\_id\)

\);

ALTER TABLE grant\_financials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grant\_fin\_org" ON grant\_financials USING \(organization\_id = \(SELECT organization\_id FROM profiles WHERE id = auth\.uid\(\)\)\);

CREATE INDEX idx\_grant\_fin\_org ON grant\_financials\(organization\_id\);

## __55\. compliance\_obligations__

Grant compliance tracking: reporting, spending restrictions, matching funds\.

CREATE TABLE compliance\_obligations \(

  id uuid PRIMARY KEY DEFAULT gen\_random\_uuid\(\),

  organization\_id uuid NOT NULL REFERENCES organizations\(id\),

  application\_id uuid NOT NULL REFERENCES applications\(id\) ON DELETE CASCADE,

  obligation\_type obligation\_type NOT NULL,

  description text NOT NULL,

  due\_date date,

  status obligation\_status DEFAULT 'pending',

  completed\_at timestamptz,

  notes text,

  created\_at timestamptz DEFAULT now\(\)

\);

ALTER TABLE compliance\_obligations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compliance\_org" ON compliance\_obligations USING \(organization\_id = \(SELECT organization\_id FROM profiles WHERE id = auth\.uid\(\)\)\);

CREATE INDEX idx\_compliance\_org ON compliance\_obligations\(organization\_id\);

CREATE INDEX idx\_compliance\_due ON compliance\_obligations\(due\_date\);

CREATE INDEX idx\_compliance\_status ON compliance\_obligations\(status\);

## __56\. deadline\_predictions__

AI\-predicted future deadlines based on historical patterns\.

CREATE TABLE deadline\_predictions \(

  id uuid PRIMARY KEY DEFAULT gen\_random\_uuid\(\),

  organization\_id uuid NOT NULL REFERENCES organizations\(id\),

  funder\_id uuid NOT NULL REFERENCES funders\(id\) ON DELETE CASCADE,

  predicted\_post\_date date,

  predicted\_deadline date,

  confidence integer CHECK \(confidence >= 0 AND confidence <= 100\),

  based\_on\_years jsonb DEFAULT '\[\]',

  created\_at timestamptz DEFAULT now\(\)

\);

ALTER TABLE deadline\_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deadline\_pred\_org" ON deadline\_predictions USING \(organization\_id = \(SELECT organization\_id FROM profiles WHERE id = auth\.uid\(\)\)\);

CREATE INDEX idx\_deadline\_pred\_org ON deadline\_predictions\(organization\_id\);

CREATE INDEX idx\_deadline\_pred\_funder ON deadline\_predictions\(funder\_id\);

## __57\. white\_label\_configs__

Consultant\-tier branding configuration for client portals\.

CREATE TABLE white\_label\_configs \(

  id uuid PRIMARY KEY DEFAULT gen\_random\_uuid\(\),

  organization\_id uuid NOT NULL REFERENCES organizations\(id\) UNIQUE,

  logo\_url text,

  primary\_color text DEFAULT '\#0a0a1a',

  secondary\_color text DEFAULT '\#1e40af',

  accent\_color text DEFAULT '\#7c3aed',

  custom\_domain text,

  favicon\_url text,

  company\_name text,

  is\_active boolean DEFAULT false,

  created\_at timestamptz DEFAULT now\(\),

  updated\_at timestamptz DEFAULT now\(\)

\);

ALTER TABLE white\_label\_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "white\_label\_org" ON white\_label\_configs USING \(organization\_id = \(SELECT organization\_id FROM profiles WHERE id = auth\.uid\(\)\)\);

## __58\. automation\_notifications__

Alert records for automation events, agent completions, and system notices\.

CREATE TABLE automation\_notifications \(

  id uuid PRIMARY KEY DEFAULT gen\_random\_uuid\(\),

  organization\_id uuid NOT NULL REFERENCES organizations\(id\),

  event\_type text NOT NULL,

  title text NOT NULL,

  message text,

  is\_read boolean DEFAULT false,

  sent\_via notification\_channel DEFAULT 'in\_app',

  related\_entity\_type text,

  related\_entity\_id uuid,

  created\_at timestamptz DEFAULT now\(\)

\);

ALTER TABLE automation\_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auto\_notif\_org" ON automation\_notifications USING \(organization\_id = \(SELECT organization\_id FROM profiles WHERE id = auth\.uid\(\)\)\);

CREATE INDEX idx\_auto\_notif\_org ON automation\_notifications\(organization\_id\);

CREATE INDEX idx\_auto\_notif\_read ON automation\_notifications\(is\_read, created\_at DESC\);

# __3\. New Feature Flags \(platform\_config\)__

__Key__

__Starter__

__Pro__

__Enterprise__

__Consultant__

feature\.grants\_gov

true

true

true

true

feature\.sam\_gov

true

true

true

true

feature\.propublica

true

true

true

true

feature\.state\_portals

1

5

all

all

feature\.custom\_api

0

2

5

unlimited

feature\.custom\_scraping

0

5

25

unlimited

feature\.candid\_api

false

true

true

true

feature\.captcha\_solving

false

true

true

true

feature\.gmail\_integration

false

true

true

true

feature\.autonomous\_mode

false

false

true

true

feature\.semi\_autonomous

false

true

true

true

feature\.competitor\_intel

false

false

true

true

feature\.financial\_recon

false

true

true

true

feature\.white\_label

false

false

false

true

feature\.multi\_channel\_outreach

email

email\_linkedin

all

all

limits\.daily\_submissions

5

25

100

unlimited

limits\.ai\_drafts\_monthly

10

50

200

unlimited

limits\.batch\_queue\_size

5

25

100

unlimited

limits\.max\_users

1

5

20

50

limits\.concurrent\_sessions

1

1

3

3

