-- Transaction that recorded the episode in the EvidenceAnchor contract on 0G Galileo.
alter table public.episodes
  add column anchor_tx text check (anchor_tx ~ '^0x[0-9a-fA-F]{64}$');
