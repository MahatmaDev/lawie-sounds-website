-- ============================================================================
--  Migration: 2026-08-03  —  WORK LOG + DATABASE-BACKED TRAINING GUIDES
--  Applied to production on 2026-08-03. Safe to re-run.
--
--  WHY: the Updates tab rendered a CHANGELOG array hardcoded in dashboard.html
--  and the Training tab a hardcoded guides array. A development log the
--  developer alone edits in a source file is a claim, not accountability — for
--  the company to pay against it, it has to live here, be stamped independently,
--  and carry the owner's acceptance.
--
--  Requires DEVELOPER_USERNAME / DEVELOPER_PASSWORD in the environment. Without
--  a third identity the developer and the owner share the `admin` account and
--  "the owner accepted this" cannot be evidenced.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS work_items (
  id            UUID          DEFAULT uuid_generate_v4() PRIMARY KEY,
  reference     TEXT,
  title         TEXT          NOT NULL,
  summary       TEXT,
  category      TEXT          DEFAULT 'feature'
                              CHECK (category IN ('feature','fix','security','performance','documentation','infrastructure','other')),
  delivered_on  DATE          NOT NULL DEFAULT CURRENT_DATE,
  fee           NUMERIC(12,2) CHECK (fee IS NULL OR (fee >= 0 AND fee <= 100000000)),
  hours         NUMERIC(6,2)  CHECK (hours IS NULL OR (hours >= 0 AND hours <= 10000)),
  evidence      TEXT,
  status        TEXT          NOT NULL DEFAULT 'delivered'
                              CHECK (status IN ('delivered','accepted','rejected','invoiced','paid')),
  created_by    TEXT,
  accepted_by   TEXT,
  accepted_at   TIMESTAMPTZ,
  rejected_reason TEXT,
  invoice_ref   TEXT,
  invoiced_at   TIMESTAMPTZ,
  paid_at       TIMESTAMPTZ,
  notes         TEXT,
  -- Set when the owner accepts. An accepted entry must stop being editable, or
  -- the signature means nothing.
  locked        BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ   DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_items_status    ON work_items (status, delivered_on DESC);
CREATE INDEX IF NOT EXISTS idx_work_items_delivered ON work_items (delivered_on DESC);
DROP INDEX IF EXISTS idx_work_items_reference;
CREATE UNIQUE INDEX idx_work_items_reference ON work_items (upper(reference)) WHERE reference IS NOT NULL AND reference <> '';

DROP TRIGGER IF EXISTS trg_work_items_updated_at ON work_items;
CREATE TRIGGER trg_work_items_updated_at
  BEFORE UPDATE ON work_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Immutable trail, written by the database. The history therefore exists even
-- if a row is edited later, and cannot be selectively rebuilt after a dispute.
CREATE TABLE IF NOT EXISTS work_item_events (
  id          UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  item_id     UUID        NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT        NOT NULL,
  actor       TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_events_item ON work_item_events (item_id, created_at DESC);

CREATE OR REPLACE FUNCTION record_work_item_event()
RETURNS TRIGGER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO work_item_events (item_id, from_status, to_status, actor, note)
    VALUES (NEW.id, NULL, NEW.status, NEW.created_by, 'created');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO work_item_events (item_id, from_status, to_status, actor, note)
    VALUES (NEW.id, OLD.status, NEW.status, COALESCE(NEW.accepted_by, NEW.created_by), NEW.rejected_reason);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_work_item_events ON work_items;
CREATE TRIGGER trg_work_item_events
  AFTER INSERT OR UPDATE OF status ON work_items
  FOR EACH ROW EXECUTE FUNCTION record_work_item_event();

CREATE OR REPLACE FUNCTION assign_work_item_reference()
RETURNS TRIGGER
SET search_path = pg_catalog, public
AS $$
DECLARE n INT;
BEGIN
  IF NEW.reference IS NULL OR trim(NEW.reference) = '' THEN
    SELECT count(*) + 1 INTO n FROM work_items;
    NEW.reference := 'LS-DEV-' || lpad(n::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_work_item_reference ON work_items;
CREATE TRIGGER trg_work_item_reference
  BEFORE INSERT ON work_items FOR EACH ROW EXECUTE FUNCTION assign_work_item_reference();

-- Training guides, out of hardcoded HTML so instructions can be corrected
-- without a developer and a deploy.
CREATE TABLE IF NOT EXISTS training_guides (
  id             UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  slug           TEXT        NOT NULL,
  title          TEXT        NOT NULL,
  intro          TEXT,
  icon           TEXT        DEFAULT 'fa-book',
  audience       TEXT        DEFAULT 'manager' CHECK (audience IN ('manager','admin','both')),
  steps          JSONB       DEFAULT '[]',
  display_order  INT         DEFAULT 0,
  is_published   BOOLEAN     DEFAULT TRUE,
  -- Instructions rot faster than code. Showing when one was last checked is
  -- what stops the manager following steps for a screen that has since changed.
  last_reviewed_on DATE,
  updated_by     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

DROP INDEX IF EXISTS idx_training_slug;
CREATE UNIQUE INDEX idx_training_slug ON training_guides (lower(trim(slug)));
CREATE INDEX IF NOT EXISTS idx_training_order ON training_guides (display_order);

DROP TRIGGER IF EXISTS trg_training_updated_at ON training_guides;
CREATE TRIGGER trg_training_updated_at
  BEFORE UPDATE ON training_guides FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Financial and contractual data. API-only: no public policies at all.
ALTER TABLE work_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_guides  ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Seed guides: see the accompanying commit. Re-running the seed is safe —
-- it uses ON CONFLICT (lower(trim(slug))) DO NOTHING.
