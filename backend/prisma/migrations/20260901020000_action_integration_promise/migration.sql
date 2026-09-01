-- Promise-to-Pay actions are a first-class recovery channel: label their
-- action rows and audit snapshots PROMISE instead of the raw payment provider.
ALTER TYPE "ActionIntegration" ADD VALUE 'PROMISE';
