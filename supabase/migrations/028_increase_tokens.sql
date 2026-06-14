-- Migration 028 — increase AI max_tokens platform config from 4096 to 8192
-- Full grant proposals require 3000-5000 words; 4096 tokens cuts them off mid-sentence.
UPDATE platform_config SET value = '8192' WHERE key = 'ai.max_tokens';
