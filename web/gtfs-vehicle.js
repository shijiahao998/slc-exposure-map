// Vehicle Positions subset of the official GTFS-Realtime protobuf wire schema:
// https://github.com/google/transit/blob/master/gtfs-realtime/proto/gtfs-realtime.proto
// Unknown fields (including TripUpdate and Alert) are skipped, never requested or used.
const header = {1:['version','string'],2:['incrementality','number'],3:['timestamp','number']};
const trip = {1:['tripId','string'],5:['routeId','string'],6:['directionId','number']};
const position = {1:['latitude','float'],2:['longitude','float'],3:['bearing','float']};
const descriptor = {1:['id','string'],2:['label','string']};
const vehicle = {1:['trip',trip],2:['position',position],5:['timestamp','number'],8:['descriptor',descriptor]};
const entity = {1:['id','string'],2:['deleted','number'],4:['vehicle',vehicle]};
const feed = {1:['header',header],2:['entities',entity,true]};

function decode(bytes, schema) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let offset = 0;
  const result = {};
  const requireBytes = length => {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) throw new Error('Truncated protobuf');
  };
  function varint() {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      requireBytes(1);
      const byte = bytes[offset++];
      value |= BigInt(byte & 127) << BigInt(i * 7);
      if (!(byte & 128)) return value;
    }
    throw new Error('Invalid protobuf integer');
  }
  while (offset < bytes.length) {
    const tag = Number(varint()), field = schema[Math.floor(tag / 8)], wire = tag & 7;
    if (tag < 8) throw new Error('Invalid protobuf tag');
    let raw;
    if (wire === 0) raw = varint();
    else if (wire === 2) {
      const length = Number(varint());
      requireBytes(length); raw = bytes.subarray(offset,offset + length); offset += length;
    } else if (wire === 5) {
      requireBytes(4); raw = view.getFloat32(offset,true); offset += 4;
    } else if (wire === 1) { requireBytes(8); offset += 8; }
    else throw new Error('Unsupported protobuf wire type');
    if (!field) continue;
    const [name,type,repeated] = field;
    const expectedWire = type === 'number' ? 0 : type === 'float' ? 5 : 2;
    if (wire !== expectedWire) throw new Error('Invalid protobuf field');
    const value = type === 'number' ? Number(raw) : type === 'float' ? raw :
      type === 'string' ? new TextDecoder().decode(raw) : decode(raw,type);
    if (type === 'number' && !Number.isSafeInteger(value)) throw new Error('Invalid protobuf number');
    if (repeated) (result[name] ||= []).push(value);
    else result[name] = value;
  }
  return result;
}

export function decodeVehicleFeed(buffer) {
  const decoded = decode(new Uint8Array(buffer),feed);
  if (!['1.0','2.0'].includes(decoded.header?.version) || decoded.header.incrementality === 1) {
    throw new Error('Unsupported Vehicle Positions feed');
  }
  return {...decoded,entities:decoded.entities || []};
}
