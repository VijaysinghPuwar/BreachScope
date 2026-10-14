-- Core schema. See internal/db/NOTES.md for why each table and index exists.

CREATE TABLE source (
  id               smallserial PRIMARY KEY,
  name             text UNIQUE NOT NULL,
  data_class       text NOT NULL CHECK (data_class IN
                     ('simulated','telemetry','aggregate_telemetry','indicator','vulnerability','breach_report')),
  licence          text NOT NULL,
  attribution      text,
  url              text,
  provides_pairs   boolean NOT NULL DEFAULT false,
  min_interval     interval NOT NULL,
  last_success_at  timestamptz,
  last_error       text
);

CREATE TABLE category (
  id     smallint PRIMARY KEY,
  slug   text UNIQUE NOT NULL,
  label  text NOT NULL
);

CREATE TABLE event (
  seq               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_uid         uuid UNIQUE NOT NULL,
  source_id         smallint NOT NULL REFERENCES source,
  source_record_id  text,
  category          smallint NOT NULL REFERENCES category,
  severity          smallint NOT NULL CHECK (severity BETWEEN 0 AND 4),
  confidence        smallint CHECK (confidence BETWEEN 0 AND 100),
  confidence_basis  text NOT NULL,
  observed_at       timestamptz,
  reported_at       timestamptz,
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  valid_until       timestamptz,
  src_ip            inet,
  src_asn           int,
  src_country       char(2),
  src_lat           real,
  src_lon           real,
  dst_sensor        text,
  dst_country       char(2),
  dst_lat           real,
  dst_lon           real,
  geo_method        text NOT NULL,
  geo_accuracy_km   int,
  h3_r3             bigint,
  attack_techniques text[],
  raw_sha256        bytea,
  attrs             jsonb,
  -- An arc needs both ends. A destination point without a source point is a data bug.
  CHECK ((dst_lat IS NULL) = (dst_lon IS NULL)),
  CHECK ((src_lat IS NULL) = (src_lon IS NULL))
);

CREATE INDEX event_observed_idx  ON event (observed_at DESC);
CREATE INDEX event_filter_idx    ON event (category, severity, src_country, observed_at DESC);
CREATE INDEX event_asn_idx       ON event (src_asn, observed_at DESC);
CREATE INDEX event_src_ip_idx    ON event USING gist (src_ip inet_ops);

CREATE TABLE rollup_hourly (
  hour         timestamptz NOT NULL,
  source_id    smallint NOT NULL REFERENCES source,
  category     smallint NOT NULL REFERENCES category,
  src_country  char(2),
  src_asn      int,
  h3_r3        bigint,
  n            int NOT NULL,
  UNIQUE NULLS NOT DISTINCT (hour, source_id, category, src_country, src_asn, h3_r3)
);

CREATE TABLE app_user (
  sub         text PRIMARY KEY,
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_role (
  sub   text NOT NULL REFERENCES app_user ON DELETE CASCADE,
  role  text NOT NULL CHECK (role IN ('analyst','admin')),
  PRIMARY KEY (sub, role)
);

CREATE TABLE investigation (
  id          uuid PRIMARY KEY,
  owner_sub   text NOT NULL REFERENCES app_user,
  title       text NOT NULL,
  filter      jsonb,
  time_from   timestamptz,
  time_to     timestamptz,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz
);

CREATE TABLE investigation_event (
  investigation_id  uuid NOT NULL REFERENCES investigation ON DELETE CASCADE,
  event_seq         bigint NOT NULL,
  snapshot          jsonb NOT NULL,
  note              text,
  PRIMARY KEY (investigation_id, event_seq)
);

CREATE TABLE investigation_share (
  investigation_id  uuid NOT NULL REFERENCES investigation ON DELETE CASCADE,
  grantee_sub       text NOT NULL REFERENCES app_user,
  permission        text NOT NULL CHECK (permission IN ('can_view','can_edit')),
  PRIMARY KEY (investigation_id, grantee_sub)
);

CREATE TABLE anomaly (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key          text NOT NULL,
  key_type     text NOT NULL CHECK (key_type IN ('asn','country','category')),
  source_id    smallint REFERENCES source,
  severity     smallint NOT NULL CHECK (severity BETWEEN 0 AND 4),
  window_end   timestamptz NOT NULL,
  observed     int NOT NULL,
  median       real NOT NULL,
  mad          real NOT NULL,
  robust_z     real NOT NULL,
  explanation  text NOT NULL,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','expected'))
);

CREATE TABLE ingest_nonce (
  nonce    text PRIMARY KEY,
  seen_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO category (id, slug, label) VALUES
  (1,  'ssh_bruteforce',      'SSH brute force'),
  (2,  'telnet_login',        'Telnet login attempts'),
  (3,  'malware_download',    'Malware download attempt'),
  (4,  'c2_server',           'C2 server'),
  (5,  'malware_url',         'Malware URL'),
  (6,  'listed_netblock',     'Listed netblock'),
  (7,  'l7_ddos_pair',        'L7 DDoS (country pair)'),
  (8,  'known_exploited_vuln','Known exploited vuln'),
  (9,  'breach_disclosure',   'Breach disclosure');
