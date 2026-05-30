-- Stores AI-generated clean description for app display, separate from raw discovery text.
ALTER TABLE local_events ADD COLUMN short_description TEXT;
