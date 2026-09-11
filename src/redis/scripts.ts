/**
 * Inline rather than a .lua file: tsc does not copy non-TS assets into dist/.
 *
 * KEYS: 1 meta, 2 zset (name -> price), 3 hash (name -> JSON offer)
 * ARGV: 1 min price, 2 max price ("-inf" / "+inf" when open-ended)
 * Returns false on a miss, {} when cached but nothing matches, else JSON offers
 * in price order. The meta key exists because an empty ZSET and a missing one
 * look identical. One script = atomic against a refresh, and one round trip.
 */
export const READ_HOTELS_IN_RANGE = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return false
end

local ids = redis.call('ZRANGEBYSCORE', KEYS[2], ARGV[1], ARGV[2])
local out = {}

-- HGET in a loop, not HMGET + unpack(ids): unpack caps out around 8000 args.
for i = 1, #ids do
  out[i] = redis.call('HGET', KEYS[3], ids[i])
end

return out
`;
