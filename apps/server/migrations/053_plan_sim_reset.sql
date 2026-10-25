-- Simulations taken over before took the research levels as percent / 10 (250 % -> 25 instead of 15): dropped, to be
-- pasted again.
UPDATE attack_plans SET sim = NULL WHERE sim IS NOT NULL;
