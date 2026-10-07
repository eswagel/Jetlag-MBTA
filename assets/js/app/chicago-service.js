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
    if(!data.patterns.some(p=>(p.lineId===lineId || (lineId==='Purple' && p.lineId==='Purple-Express')))) return {...base,reason:'unsupported-line'};
    const p=parts(stamp);const localDay=new Date(Date.UTC(+p.year,+p.month-1,+p.day));const key=dateKey(localDay);
    if(key<data.coverage.start || key>data.coverage.end) return {...base,reason:'outside-feed-coverage'};
    const stationIds=new Set(); const tripIds=[]; const tripDates={};
    const maxSeconds=Math.max(86400,...data.trips.map(t=>t.end));
    for(let offset=0; offset<=Math.ceil(maxSeconds/86400);offset++) {
      const day=new Date(localDay.getTime()-offset*86400000);const dayKey=dateKey(day);
      if(dayKey<data.coverage.start || dayKey>data.coverage.end) continue;
      const weekday=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][day.getUTCDay()];
      const active=activeService(data,dayKey,weekday);const elapsed=(stamp.getTime()-serviceOrigin(day))/1000;
      for(const t of data.trips) {
        const pattern=data.patterns[t.pattern];
        if((pattern?.lineId===lineId || (lineId==='Purple' && pattern?.lineId==='Purple-Express')) && active.has(t.serviceId) && t.start<=elapsed && elapsed<t.end) {
          pattern.stationIds.forEach(id=>stationIds.add(id));tripIds.push(t.id);tripDates[t.id]=dayKey;
        }
      }
    }
    return {...base,status:stationIds.size?'scheduled-active':'scheduled-inactive',stationIds:[...stationIds].sort(),tripIds,tripDates};
  }
  // Structural validation for imported snapshots. This does not authenticate a claimed live source.
  // Callers must compare with their own trusted source/recomputed schedule before accepting it.
  function validateSnapshot(value,{lineId,stationIds,observedAt,maxAgeMs=120000}={}) {
    if(!value || value.lineId!==lineId || !Array.isArray(value.stationIds) || !Array.isArray(stationIds)) return false;
    if(!['scheduled-active','scheduled-inactive','unknown','live-active','live-inactive','live-assisted-active','live-assisted-inactive'].includes(value.status)) return false;
    if(!['cta-gtfs-schedule','cta-gtfs-realtime','cta-gtfs-realtime+schedule'].includes(value.source)) return false;
    const timestamp=Date.parse(value.observedAt);const reference=Date.parse(observedAt);
    if(!Number.isFinite(timestamp)||!Number.isFinite(reference)||timestamp>reference||reference-timestamp>maxAgeMs) return false;
    const allowed=new Set(stationIds);
    if(new Set(value.stationIds).size!==value.stationIds.length || !value.stationIds.every(id=>typeof id==='string' && allowed.has(id))) return false;
    if((value.status==='unknown'||value.status.endsWith('-inactive'))&&value.stationIds.length) return false;
    if(value.status.endsWith('-active')&&!value.stationIds.length) return false;
    return value.source==='cta-gtfs-schedule' ? !value.status.startsWith('live-') : !value.status.startsWith('scheduled-');
  }
  let currentCalendar=null;
  function setCalendar(value){currentCalendar=value;return value;}
  function getCalendar(){return currentCalendar;}
  function allStationIds(data){return new Set(Object.values(data.stopParents || {}).map(String));}
  // A caller supplies decoded official GTFS-RT TripUpdates via a same-origin credential-holding proxy.
  // Persist the reduced evidence, so replay uses the original observation rather than today's service.
  function withRealtime(data,feed,observedAt=new Date().toISOString()) {
    const scheduled=snapshot(data,'Purple',observedAt);
    if(scheduled.status==='unknown') return {...scheduled,reason:'schedule-required-for-live-reconciliation'};
    const now=Date.parse(observedAt)/1000;const timestamp=Number(feed?.header?.timestamp);
    if(!Number.isFinite(timestamp)||timestamp>now+30||now-timestamp>120) return {...scheduled,fallbackReason:'live-feed-stale-or-invalid'};
    const known=new Map(data.trips.map(t=>[t.id,t]));const allowed=allStationIds(data);
    const evidence=[];
    for(const entity of feed.entity || []) {
      const update=entity.trip_update || entity.tripUpdate;
      if(!update)continue;
      const trip=update.trip || {};const id=String(trip.trip_id || trip.tripId || '');
      const route=trip.route_id || trip.routeId;const scheduledTrip=known.get(id);
      if(route!=='P' && !scheduledTrip)continue;
      if(route && route!=='P')continue;
      const serviceDate=trip.start_date || trip.startDate;
      if(serviceDate && scheduled.tripDates?.[id] && serviceDate!==scheduled.tripDates[id])continue;
      const relation=trip.schedule_relationship ?? trip.scheduleRelationship ?? 0;
      const canceled=relation===3 || relation==='CANCELED';
      const updates=update.stop_time_update || update.stopTimeUpdate || [];
      const added=[],skipped=[];
      for(const stop of updates){
        const raw=String(stop.stop_id || stop.stopId || '');
        const sequence=stop.stop_sequence ?? stop.stopSequence;
        // GTFS-RT permits sequence-only updates for trips identified in the static feed.
        // Preserve real GTFS sequence values: they need not be contiguous or zero-based.
        const sequencedParent=sequence==null ? null : scheduledTrip?.stopSequenceParents?.[String(sequence)];
        const parent=raw ? data.stopParents?.[raw] : sequencedParent;
        if(raw && sequencedParent && parent!==sequencedParent)continue;
        if(!parent || !allowed.has(String(parent)))continue;
        const rel=stop.schedule_relationship ?? stop.scheduleRelationship ?? 0;
        if(rel===1 || rel==='SKIPPED') {skipped.push(String(parent));continue;}
        const event=stop.departure || stop.arrival;
        const time=Number(event?.time);
        // Only positive, current stop evidence; no station inferred from missing predictions.
        if(Number.isFinite(time)&&time>=now-120&&time<=now+(scheduled.tripIds.includes(id)?7200:1200))added.push(String(parent));
      }
      if(canceled || added.length || (skipped.length && scheduled.tripIds.includes(id)))evidence.push({tripId:id,canceled,stationIds:[...new Set(added)].sort(),skippedStationIds:[...new Set(skipped)].sort()});
    }
    if(!evidence.length)return {...scheduled,fallbackReason:'no-current-purple-live-evidence'};
    return reconcile(data,scheduled,{timestamp,evidence});
  }
  function reconcile(data,scheduled,liveEvidence){
    const byTrip=new Map();const definitions=new Map(data.trips.map(t=>[t.id,t]));
    for(const id of scheduled.tripIds || []){
      const trip=definitions.get(id);if(trip)byTrip.set(id,new Set(data.patterns[trip.pattern].stationIds));
    }
    for(const item of liveEvidence.evidence){
      if(item.canceled){byTrip.delete(item.tripId);continue;}
      const stops=byTrip.get(item.tripId)||new Set();
      item.skippedStationIds.forEach(id=>stops.delete(id));item.stationIds.forEach(id=>stops.add(id));byTrip.set(item.tripId,stops);
    }
    const stationIds=[...new Set([...byTrip.values()].flatMap(s=>[...s]))].sort();
    return {...scheduled,source:'cta-gtfs-realtime+schedule',status:stationIds.length?'live-assisted-active':'live-assisted-inactive',stationIds,liveEvidence};
  }
  function replay(data,value){
    if(!data || value.feedVersion!==data.feedVersion || value.lineId!=='Purple')return null;
    const scheduled=snapshot(data,'Purple',value.observedAt);
    if(scheduled.status==='unknown')return null;
    if(value.source==='cta-gtfs-schedule')return scheduled;
    if(value.source!=='cta-gtfs-realtime+schedule')return null;
    const e=value.liveEvidence;const observed=Date.parse(value.observedAt)/1000;const allowed=allStationIds(data);
    if(!e || !Number.isFinite(e.timestamp)||e.timestamp>observed+30||observed-e.timestamp>120||!Array.isArray(e.evidence))return null;
    for(const item of e.evidence){
      if(typeof item.tripId!=='string'||typeof item.canceled!=='boolean'||!Array.isArray(item.stationIds)||!Array.isArray(item.skippedStationIds))return null;
      if(![...item.stationIds,...item.skippedStationIds].every(id=>typeof id==='string'&&allowed.has(id)))return null;
    }
    // Evidence is a portable observation from the sender, not cryptographically authenticated.
    return reconcile(data,scheduled,e);
  }
  const api={snapshot,validateSnapshot,setCalendar,getCalendar,withRealtime,replay};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.ChicagoService=api;
})(typeof window!=='undefined'?window:globalThis);
