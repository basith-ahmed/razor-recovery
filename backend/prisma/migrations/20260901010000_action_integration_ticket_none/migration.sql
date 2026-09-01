-- Add TICKET (real ticket-service escalations) and NONE (policy skips, no
-- integration involved) to the action integration enum.
ALTER TYPE "ActionIntegration" ADD VALUE 'TICKET';
ALTER TYPE "ActionIntegration" ADD VALUE 'NONE';
