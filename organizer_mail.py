from env_settings import env_value, smtp_password, smtp_login
"""Preview or send an organizer invitation for a verified public UMich inbox."""
import argparse, hashlib, html, json, os, re, secrets, smtplib, sqlite3, ssl, subprocess
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import urlparse
ROOT=Path(__file__).parent
for line in (ROOT/'.env').read_text().splitlines() if (ROOT/'.env').exists() else []:
    if '=' in line:
        key,value=line.split('=',1);os.environ.setdefault(key.strip(),env_value(value))

def fetch_event(url):
    parsed=urlparse(url)
    if parsed.scheme!='https' or parsed.hostname!='events.umich.edu' or not re.fullmatch(r'/event/\d+(?:-\d+)?/?',parsed.path):
        raise ValueError('Use an official https://events.umich.edu/event/... URL.')
    result=subprocess.run(['curl','--fail','--silent','--show-error','--max-time','20',url],capture_output=True,text=True,check=True,timeout=25)
    page=result.stdout
    match=re.search(r'<title[^>]*>(.*?)</title>',page,re.S|re.I)
    title=html.unescape(re.sub('<[^>]+>','',match.group(1))).strip() if match else 'Your UMich event'
    title=re.sub(r'\s*\|\s*Happening\s*@\s*Michigan.*$','',title,flags=re.I).strip()
    # Candidates only: a published address is not proof of a departmental/shared inbox.
    text=html.unescape(re.sub('<[^>]+>',' ',page))
    mailto=' '.join(re.findall(r'mailto:([^"\s<>]+)',html.unescape(page),re.I))
    emails=sorted(set(e.lower() for e in re.findall(r'[A-Za-z0-9._%+-]+@umich\.edu\b',text+' '+mailto,re.I)))
    return {'url':url,'title':title,'candidates':emails}

def invitation(event,site_url):
    parsed=urlparse(site_url)
    if parsed.scheme!='https' or not parsed.hostname or parsed.hostname in ('localhost','127.0.0.1','::1'):
        raise ValueError('PUBLIC_SITE_URL must be a publicly accessible HTTPS website, not localhost.')
    subject='CampusBite: share surplus food from '+event['title'].replace('\r',' ').replace('\n',' ')[:150]
    body=f"""Hello,

We found your event, {event['title']}, on the University of Michigan events calendar:
{event['url']}

CampusBite is a student project that helps campus organizers share announcements about surplus food. If your event has food left over, you are welcome to add its pickup details here:
{site_url.rstrip('/')}

How to add the details (no account required):
1. Open the link and choose “I just here to add events or the detail of the event” in the welcome window.
2. Enter the event name, organizer and contact person email.
3. Choose the campus building, or select Off-campus location, search for the place and confirm its map pin. Add the room or pickup instructions.
4. Enter the event date/time. If food is available, enter its pickup deadline, portions and dietary information you can confirm.
5. Select Add event. Save the private management link shown on the page.
6. If food runs out or pickup ends early, use that private link to remove the announcement. Listings with pickup deadlines expire automatically.

Adding an event is optional. Student registrations do not reserve food, and we cannot guarantee availability. CampusBite is a student project, not an official University of Michigan service.

Thank you for helping reduce food waste!
The CampusBite team
"""
    return subject,body

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--event-url',required=True)
    parser.add_argument('--recipient',help='An address published on this event page; verify it is a shared office inbox.')
    parser.add_argument('--public-inbox-verified',action='store_true')
    parser.add_argument('--send',action='store_true',help='Send the reviewed invitation using configured SMTP; otherwise preview only.')
    args=parser.parse_args();event=fetch_event(args.event_url)
    print('Event:',event['title']);print('Published email candidates:',', '.join(event['candidates']) or 'None — do not guess an email.')
    if not args.recipient: return
    recipient=args.recipient.strip().lower()
    if recipient not in event['candidates']: raise ValueError('Recipient must be published on the official event page.')
    if not args.public_inbox_verified: raise ValueError('Verify the recipient is the office/shared inbox, then use --public-inbox-verified.')
    subject,body=invitation(event,os.environ.get('PUBLIC_SITE_URL',''))
    if not args.send:
        print('\nTo:',recipient);print('Subject:',subject);print('\n'+body);return
    sender=os.environ.get('SMTP_FROM','');host=os.environ.get('SMTP_HOST','')
    if not sender or not host: raise ValueError('Configure SMTP_FROM, SMTP_HOST and PUBLIC_SITE_URL before sending.')
    message=EmailMessage();message['From']=sender;message['To']=recipient;message['Subject']=subject;message['Message-ID']='<'+secrets.token_hex(16)+'@'+sender.split('@')[-1]+'>';message.set_content(body)
    key=hashlib.sha256((event['url']+'|'+recipient).encode()).hexdigest()
    (ROOT/'data').mkdir(exist_ok=True)
    with sqlite3.connect(ROOT/'data/campusbite.sqlite') as db:
        db.execute('CREATE TABLE IF NOT EXISTS organizer_invitations (id TEXT PRIMARY KEY, event_url TEXT, recipient TEXT, subject TEXT, body TEXT, status TEXT, created TEXT, error TEXT)')
        # A reservation prevents duplicate dispatch even across concurrent CLI runs.
        try: db.execute('INSERT INTO organizer_invitations VALUES (?,?,?,?,?,?,?,?)',(key,event['url'],recipient,subject,body,'sending',datetime.now(timezone.utc).isoformat(),''));db.commit()
        except sqlite3.IntegrityError: raise ValueError('An invitation for this event and inbox already exists. Check its status before retrying.')
        try:
            mode=os.environ.get('SMTP_SECURITY','starttls');port=int(os.environ.get('SMTP_PORT','465' if mode=='ssl' else '587'))
            if mode not in ('ssl','starttls'): raise ValueError('SMTP_SECURITY must be ssl or starttls.')
            client=smtplib.SMTP_SSL(host,port,timeout=20,context=ssl.create_default_context()) if mode=='ssl' else smtplib.SMTP(host,port,timeout=20)
            with client:
                if mode=='starttls': client.ehlo();client.starttls(context=ssl.create_default_context());client.ehlo()
                if os.environ.get('SMTP_USERNAME'): smtp_login(client,os.environ.get('SMTP_HOST',''),os.environ['SMTP_USERNAME'],os.environ.get('SMTP_PASSWORD',''))
                client.send_message(message)
            db.execute("UPDATE organizer_invitations SET status='sent' WHERE id=?",(key,));db.commit();print('SMTP accepted the invitation. Delivery is not yet confirmed.')
        except Exception as error:
            db.execute("UPDATE organizer_invitations SET status='failed',error=? WHERE id=?",(type(error).__name__,key));db.commit();raise RuntimeError('Sending failed. Check SMTP settings; secrets are not shown.') from None
if __name__=='__main__':
    try: main()
    except Exception as error: raise SystemExit(str(error))
