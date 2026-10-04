from env_settings import env_value, smtp_password, smtp_login
from smtp_tls import smtp_tls_context
import os, smtplib, ssl, json, sqlite3, base64, re, urllib.request, urllib.parse, html
from email.message import EmailMessage
from urllib.parse import urlparse
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).parent

def organizer_claim_url(site,claim_token):
    return site.rstrip('/')+'/?'+urllib.parse.urlencode({'organizer_claim':claim_token})

def notification_body(title,claim_url,site):
    demo_note='\nLOCAL DEMO ONLY: This website link works only on the computer running CampusBite. It is not a public website.\n' if urlparse(site).hostname in ('localhost','127.0.0.1','::1') else ''
    return f"""Hello,

Your event was successfully added to CampusBite: {title}

Your private event-management link is ready.

To update food availability:
1. Open this secure link: {claim_url}
{demo_note}2. CampusBite will open this event's private management page directly.
3. Click “Food has run out” when needed. Its status becomes False and it is removed from the public pickup list.

This private link manages only this event. It does not grant access to other events or accounts.

The CampusBite team
"""

def notification_html(title,claim_url,site):
    local=urlparse(site).hostname in ('localhost','127.0.0.1','::1')
    note='<p><strong>Local demo:</strong> this link works only on the computer running CampusBite.</p>' if local else ''
    return f'''<!doctype html><html><body style="font-family:Arial,sans-serif;color:#18212b;line-height:1.55">
<h2 style="color:#087a4b">Your CampusBite event was added</h2><p>{html.escape(title)}</p>
<p>Your private event-management link is ready.</p>{note}
<p><a href="{html.escape(claim_url,quote=True)}" style="display:inline-block;background:#087a4b;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Manage this event</a></p>
<p>The link opens this event's management page directly. Use <strong>Food has run out</strong> when needed.</p>
<p>Keep this link private. Anyone who has it can close this event.</p><p>The CampusBite team</p></body></html>'''
def send_notification(db,notification_id):
    site=os.environ.get('PUBLIC_SITE_URL','');parsed=urlparse(site)
    local_demo=os.environ.get('MAIL_DEMO_MODE')=='1' and parsed.scheme in ('http','https') and parsed.hostname in ('localhost','127.0.0.1','::1')
    public_site=parsed.scheme=='https' and bool(parsed.hostname) and parsed.hostname not in ('localhost','127.0.0.1','::1')
    if not (local_demo or public_site):
        return 'pending_configuration'
    with sqlite3.connect(db) as c:
        c.row_factory=sqlite3.Row
        row=c.execute('SELECT * FROM event_notification_outbox WHERE id=?',(notification_id,)).fetchone()
        if not row:return 'not_found'
        if row['status']!='pending_configuration':return row['status']
        channel=row['channel'] if 'channel' in row.keys() else 'email'
        if channel=='sms':
            sid=os.environ.get('TWILIO_ACCOUNT_SID','');auth=os.environ.get('TWILIO_AUTH_TOKEN','');sender=os.environ.get('TWILIO_FROM_NUMBER','')
            if not re.fullmatch(r'AC[0-9a-fA-F]{32}',sid) or not auth or not re.fullmatch(r'\+[1-9]\d{7,14}',sender):return 'pending_configuration'
        elif not all(os.environ.get(k) for k in ('SMTP_HOST','SMTP_FROM','SMTP_PASSWORD')):return 'pending_configuration'
        claimed=c.execute("UPDATE event_notification_outbox SET status='sending' WHERE id=? AND status='pending_configuration'",(notification_id,));c.commit()
        if claimed.rowcount!=1:return 'already_claimed'
        payload=json.loads(row['payload'])
        try:
            if channel=='sms':
                text='CampusBite: '+payload['title'][:60]+' added. Manage this event: '+organizer_claim_url(site,payload['claim_token'])+'. Keep this private link secure.'
                if local_demo:text+=' Local demo link works only on the host computer.'
                data=urllib.parse.urlencode({'To':row['recipient'],'From':sender,'Body':text}).encode()
                req=urllib.request.Request('https://api.twilio.com/2010-04-01/Accounts/'+sid+'/Messages.json',data=data,headers={'Authorization':'Basic '+base64.b64encode((sid+':'+auth).encode()).decode(),'Content-Type':'application/x-www-form-urlencoded'})
                with urllib.request.urlopen(req,timeout=15,context=smtp_tls_context()) as response:result=json.load(response)
                if not result.get('sid') or result.get('status') in ('failed','undelivered'):raise ValueError('SMS not accepted')
                c.execute("UPDATE event_notification_outbox SET status='sent',payload='',error='' WHERE id=?",(notification_id,));c.commit();return 'sent'
            message=EmailMessage();message['From']=os.environ['SMTP_FROM'];message['To']=row['recipient'];message['Subject']='CampusBite: event added — '+payload['title'].replace('\r',' ').replace('\n',' ')[:120]
            claim_url=organizer_claim_url(site,payload['claim_token'])
            message.set_content(notification_body(payload['title'],claim_url,site))
            message.add_alternative(notification_html(payload['title'],claim_url,site),subtype='html')
            mode=os.environ.get('SMTP_SECURITY','starttls');host=os.environ['SMTP_HOST'];port=int(os.environ.get('SMTP_PORT','465' if mode=='ssl' else '587'))
            if mode not in ('ssl','starttls'):raise ValueError('Invalid SMTP security mode')
            client=smtplib.SMTP_SSL(host,port,timeout=15,context=smtp_tls_context()) if mode=='ssl' else smtplib.SMTP(host,port,timeout=15)
            with client:
                if mode=='starttls':client.ehlo();client.starttls(context=smtp_tls_context());client.ehlo()
                if os.environ.get('SMTP_USERNAME'):smtp_login(client,os.environ.get('SMTP_HOST',''),os.environ['SMTP_USERNAME'],os.environ.get('SMTP_PASSWORD',''))
                client.send_message(message)
            c.execute("UPDATE event_notification_outbox SET status='sent',payload='',error='' WHERE id=?",(notification_id,));c.commit();return 'sent'
        except Exception as error:
            c.execute("UPDATE event_notification_outbox SET status='failed',error=? WHERE id=?",(type(error).__name__,notification_id));c.commit();return 'failed'
if __name__=='__main__':
    for line in (ROOT/'.env').read_text().splitlines() if (ROOT/'.env').exists() else []:
        if '=' in line:
            k,v=line.split('=',1);os.environ.setdefault(k.strip(),env_value(v))
    db=ROOT/'data/campusbite.sqlite'
    with sqlite3.connect(db) as c:ids=[r[0] for r in c.execute("SELECT id FROM event_notification_outbox WHERE status='pending_configuration'")]
    for nid in ids:print(nid,send_notification(db,nid))
