/* Pure schedule evaluation. No network requests or credentials. GTFS is NOT live service. */
(function (root) {
  'use strict';
  const zone = 'America/Chicago';
  const formatter = new Intl.DateTimeFormat('en-US', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  function parts(at) {return Object.fromEntries(formatter.formatToParts(at).map(p=>[p.type,p.value]));}
  function dateKey(d) {return d.toISOString().slice(0,10).replace(/-/g,'');}
  // GTFS seconds are elapsed from local noon minus 12h, including on DST transition days.
  function serviceOrigin(day) {
    const nominal = Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),12);
    const probe = parts(new Date(nominal));
    const local = Date.UTC(+probe.year,+probe.month-1,+probe.day,+probe.hour,+probe.minute,+probe.second);
    return nominal + (nominal-local) - 12*3600000;
  }
  function activeService(data,key,weekday) {
    const active=new Set(data.calendar.filter(c=>c.start_date<=key && c.end_date>=key && c[weekday]==='1').map(c=>c.service_id));
    for (const e of data.exceptions) if(e.date===key) {if(e.exception_type==='1') active.add(e.service_id);else if(e.exception_type==='2') active.delete(e.service_id);}
    return active;
  }
  function snapshot(data,lineId,observedAt=new Date().toISOString()) {
    const stamp=new Date(observedAt);
    const base={lineId,observedAt:Number.isFinite(stamp.getTime())?stamp.toISOString():String(observedAt),source:'cta-gtfs-schedule',status:'unknown',stationIds:[],feedVersion:data?.feedVersion || null};
    if(!Number.isFinite(stamp.getTime())) return {...base,reason:'invalid-time'};
    if(!data || !data.coverage || !Array.isArray(data.trips) || !Array.isArray(data.patterns)) return {...base,reason:'missing-schedule'};
    if(!data.patterns.some(p=>p.lineId===lineId)) return {...base,reason:'unsupported-line'};
    const p=parts(stamp);const localDay=new Date(Date.UTC(+p.year,+p.month-1,+p.day));const key=dateKey(localDay);
    if(key<data.coverage.start || key>data.coverage.end) return {...base,reason:'outside-feed-coverage'};
    const stationIds=new Set(); const tripIds=[];
    const maxSeconds=Math.max(86400,...data.trips.map(t=>t.end));
    for(let offset=0; offset<=Math.ceil(maxSeconds/86400);offset++) {
      const day=new Date(localDay.getTime()-offset*86400000);const dayKey=dateKey(day);
      if(dayKey<data.coverage.start || dayKey>data.coverage.end) continue;
      const weekday=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][day.getUTCDay()];
      const active=activeService(data,dayKey,weekday);const elapsed=(stamp.getTime()-serviceOrigin(day))/1000;
      for(const t of data.trips) {
        const pattern=data.patterns[t.pattern];
        if(pattern?.lineId===lineId && active.has(t.serviceId) && t.start<=elapsed && elapsed<t.end) {
          pattern.stationIds.forEach(id=>stationIds.add(id));tripIds.push(t.id);
        }
      }
    }
    return {...base,status:stationIds.size?'scheduled-active':'scheduled-inactive',stationIds:[...stationIds].sort(),tripIds};
  }
  // Structural validation for imported snapshots. This does not authenticate a claimed live source.
  // Callers must compare with their own trusted source/recomputed schedule before accepting it.
  function validateSnapshot(value,{lineId,stationIds,observedAt,maxAgeMs=120000}={}) {
    if(!value || value.lineId!==lineId || !Array.isArray(value.stationIds) || !Array.isArray(stationIds)) return false;
    if(!['scheduled-active','scheduled-inactive','unknown','live-active','live-inactive'].includes(value.status)) return false;
    if(!['cta-gtfs-schedule','cta-gtfs-realtime'].includes(value.source)) return false;
    const timestamp=Date.parse(value.observedAt);const reference=Date.parse(observedAt);
    if(!Number.isFinite(timestamp)||!Number.isFinite(reference)||timestamp>reference||reference-timestamp>maxAgeMs) return false;
    const allowed=new Set(stationIds);
    if(new Set(value.stationIds).size!==value.stationIds.length || !value.stationIds.every(id=>typeof id==='string' && allowed.has(id))) return false;
    if((value.status==='unknown'||value.status.endsWith('-inactive'))&&value.stationIds.length) return false;
    if(value.status.endsWith('-active')&&!value.stationIds.length) return false;
    return value.source==='cta-gtfs-schedule' ? !value.status.startsWith('live-') : !value.status.startsWith('scheduled-');
  }
  const api={snapshot,validateSnapshot};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.ChicagoService=api;
})(typeof window!=='undefined'?window:globalThis);
