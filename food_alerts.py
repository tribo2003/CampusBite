"""Opt-in, deduplicated free-food SMS notifications."""
import os,re,json,sqlite3,urllib.request,urllib.parse,base64,threading
from datetime import datetime,timezone
from smtp_tls import smtp_tls_context

def initialize(c):
    columns={row[1] for row in c.execute('PRAGMA table_info(users)')}
    for name,kind in [('sms_opt_in','INTEGER NOT NULL DEFAULT 0'),('sms_phone',"TEXT NOT NULL DEFAULT ''"),('sms_opt_in_at',"TEXT NOT NULL DEFAULT ''")]:
        if name not in columns:c.execute('ALTER TABLE users ADD COLUMN '+name+' '+kind)
    c.execute('CREATE TABLE IF NOT EXISTS food_alert_events (id TEXT PRIMARY KEY, payload TEXT NOT NULL, observed TEXT NOT NULL)')
    c.execute("CREATE TABLE IF NOT EXISTS food_alert_outbox (user_id TEXT NOT NULL,event_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending_configuration',error TEXT NOT NULL DEFAULT '',PRIMARY KEY(user_id,event_id))")

def observe(db,events):
    now=datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(db) as c:
        for event in events:
            if event.get('sample') or not event.get('confirmed') or not event.get('deadline'):continue
            if datetime.fromisoformat(event['deadline'])<=datetime.now(timezone.utc):continue
            # Keep public data only; never include organizer credentials or contacts.
            data={key:event.get(key) for key in ('id','title','location','deadline')}
            first=c.execute('INSERT OR IGNORE INTO food_alert_events VALUES (?,?,?)',(event['id'],json.dumps(data),now)).rowcount
            if first:
                for uid, in c.execute('SELECT id FROM users WHERE sms_opt_in=1 AND sms_opt_in_at<=?',(now,)).fetchall():
                    c.execute('INSERT OR IGNORE INTO food_alert_outbox (user_id,event_id) VALUES (?,?)',(uid,event['id']))

def deliver(db):
    sid=os.environ.get('TWILIO_ACCOUNT_SID','');token=os.environ.get('TWILIO_AUTH_TOKEN','');sender=os.environ.get('TWILIO_FROM_NUMBER','');site=os.environ.get('PUBLIC_SITE_URL','')
    configured=bool(re.fullmatch(r'AC[0-9a-fA-F]{32}',sid) and token and re.fullmatch(r'\+[1-9]\d{7,14}',sender) and site)
    with sqlite3.connect(db) as c:
        rows=c.execute("SELECT o.user_id,o.event_id,u.sms_opt_in,u.sms_phone,e.payload FROM food_alert_outbox o JOIN users u ON u.id=o.user_id JOIN food_alert_events e ON e.id=o.event_id WHERE o.status='pending_configuration'").fetchall()
        for uid,eid,opted,phone,payload in rows:
            event=json.loads(payload)
            unavailable=c.execute('SELECT 1 FROM event_availability WHERE event_id=? AND status=0',(eid,)).fetchone()
            closed=c.execute('SELECT 1 FROM user_events WHERE id=? AND (status=0 OR closed=1)',(eid,)).fetchone()
            if not opted or unavailable or closed or datetime.fromisoformat(event['deadline'])<=datetime.now(timezone.utc):
                c.execute("UPDATE food_alert_outbox SET status='cancelled' WHERE user_id=? AND event_id=?",(uid,eid));c.commit();continue
            if not configured:continue
            claimed=c.execute("UPDATE food_alert_outbox SET status='sending' WHERE user_id=? AND event_id=? AND status='pending_configuration'",(uid,eid)).rowcount;c.commit()
            if not claimed:continue
            text='CampusBite free food: '+str(event['title'])[:90]+'. '+str(event['location'])[:120]+'. Pickup deadline: '+event['deadline']+'. '+site+'. First come, first served. Turn off SMS in Personal to unsubscribe.'
            if urllib.parse.urlparse(site).hostname in ('localhost','127.0.0.1','::1'):text+=' Local demo: link works only on the host computer.'
            try:
                data=urllib.parse.urlencode({'To':phone,'From':sender,'Body':text}).encode()
                req=urllib.request.Request('https://api.twilio.com/2010-04-01/Accounts/'+sid+'/Messages.json',data=data,headers={'Authorization':'Basic '+base64.b64encode((sid+':'+token).encode()).decode(),'Content-Type':'application/x-www-form-urlencoded'})
                with urllib.request.urlopen(req,timeout=15,context=smtp_tls_context()) as response:result=json.load(response)
                if not result.get('sid') or result.get('status') in ('failed','undelivered'):raise ValueError('SMS rejected')
                c.execute("UPDATE food_alert_outbox SET status='sent',error='' WHERE user_id=? AND event_id=?",(uid,eid))
            except Exception as error:c.execute("UPDATE food_alert_outbox SET status='failed',error=? WHERE user_id=? AND event_id=?",(type(error).__name__,uid,eid))
            c.commit()

def start_worker(db,port):
    def work():
        while True:
            try:
                # Refresh the existing event ingestion without needing an open browser.
                with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/api/events',timeout=120) as response:response.read()
                deliver(db)
            except Exception:pass
            threading.Event().wait(60)
    threading.Thread(target=work,daemon=True,name='food-sms-alerts').start()
