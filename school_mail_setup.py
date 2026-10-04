from env_settings import env_value, smtp_password, smtp_login
from smtp_tls import smtp_tls_context
"""Configure school-approved SMTP locally; secrets are never printed."""
import argparse,getpass,os,re,smtplib,ssl,socket
from pathlib import Path
from urllib.parse import urlparse
ROOT=Path(__file__).parent
FIELDS=['PUBLIC_SITE_URL','SMTP_HOST','SMTP_PORT','SMTP_SECURITY','SMTP_FROM','SMTP_USERNAME','SMTP_PASSWORD']
def load():
    settings={}
    for line in (ROOT/'.env').read_text().splitlines() if (ROOT/'.env').exists() else []:
        if '=' in line:
            k,v=line.split('=',1);settings[k.strip()]=env_value(v)
    return settings

def check(settings,network=False):
    missing=[k for k in FIELDS if not settings.get(k)]
    if missing:raise ValueError('Missing settings: '+', '.join(missing))
    parsed=urlparse(settings['PUBLIC_SITE_URL'])
    local_demo=settings.get('MAIL_DEMO_MODE')=='1' and parsed.scheme in ('http','https') and parsed.hostname in ('localhost','127.0.0.1','::1')
    public_site=parsed.scheme=='https' and bool(parsed.hostname) and parsed.hostname not in ('localhost','127.0.0.1','::1')
    if not (local_demo or public_site):raise ValueError('Use a public HTTPS URL, or enable MAIL_DEMO_MODE=1 for localhost.')
    if settings['SMTP_SECURITY'] not in ('ssl','starttls'):raise ValueError('SMTP_SECURITY must be ssl or starttls.')
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',settings['SMTP_FROM']):raise ValueError('Enter a valid sender email.')
    port=int(settings['SMTP_PORT'])
    if not 1<=port<=65535:raise ValueError('Invalid SMTP port.')
    if not network:return
    diagnose(settings)

def diagnose(settings):
    check(settings)
    host=settings['SMTP_HOST'];port=int(settings['SMTP_PORT']);mode=settings['SMTP_SECURITY']
    stage='DNS lookup';client=None;transport=None
    try:
        addresses=socket.getaddrinfo(host,port,type=socket.SOCK_STREAM)
        print('PASS DNS lookup ('+str(len(addresses))+' addresses)')
        stage='TCP connection'
        transport=socket.create_connection((host,port),timeout=15)
        print('PASS TCP connection')
        if mode=='ssl':
            stage='TLS handshake'
            transport=smtp_tls_context().wrap_socket(transport,server_hostname=host)
            print('PASS TLS handshake ('+str(transport.version())+')')
        client=smtplib.SMTP(timeout=15,local_hostname='localhost')
        client._host=host;client.sock=transport
        stage='SMTP greeting'
        code,message=client.getreply()
        if code!=220:raise smtplib.SMTPConnectError(code,b'Unexpected SMTP greeting')
        print('PASS SMTP greeting (220)')
        stage='EHLO'
        code,message=client.ehlo()
        if code!=250:raise smtplib.SMTPHeloError(code,b'EHLO rejected')
        print('PASS EHLO (250)')
        if mode=='starttls':
            stage='STARTTLS handshake'
            client.starttls(context=smtp_tls_context())
            print('PASS STARTTLS handshake')
            stage='EHLO after TLS'
            code,message=client.ehlo()
            if code!=250:raise smtplib.SMTPHeloError(code,b'EHLO rejected')
            print('PASS EHLO after TLS')
        stage='Authentication'
        smtp_login(client,host,settings['SMTP_USERNAME'],settings['SMTP_PASSWORD'])
        print('PASS Authentication; no email sent.')
    except Exception as error:
        code=getattr(error,'smtp_code',None)
        detail=' SMTP code '+str(code) if code is not None else ''
        raise ValueError('FAIL at '+stage+': '+type(error).__name__+detail+'. No messages sent.') from None
    finally:
        if client:client.close()
        elif transport:transport.close()

def configure(umich=False):
    current=load();values={}
    if umich:
        print('UMich ITS Authenticated SMTP requires prior registration: https://documentation.its.umich.edu/authenticated-smtp')
        if input('Has ITS enabled Authenticated SMTP for your account? [yes/no]: ').strip().lower()!='yes':raise ValueError('Register with ITS first; settings were not changed.')
        values.update(SMTP_HOST='smtp.mail.umich.edu',SMTP_PORT='465',SMTP_SECURITY='ssl')
    else:
        print('Use your school-approved SMTP settings. Gmail/Outlook OAuth-only accounts cannot use a regular password here.')
        values['SMTP_HOST']=input('School SMTP hostname: ').strip()
        values['SMTP_SECURITY']=input('Encryption (ssl or starttls): ').strip()
        values['SMTP_PORT']=input('Port (465 for SSL, 587 for STARTTLS): ').strip()
    values['SMTP_FROM']=input('Your school sender email: ').strip()
    if umich and not values['SMTP_FROM'].endswith('@umich.edu'):raise ValueError('UMich preset requires an @umich.edu sender.')
    values['SMTP_USERNAME']=input('SMTP username (UMich: uniqname): ').strip()
    values['SMTP_PASSWORD']=getpass.getpass('School-approved SMTP password (hidden): ')
    values['PUBLIC_SITE_URL']=input('Public CampusBite HTTPS URL: ').strip().rstrip('/')
    if any('\n' in v or '\r' in v for v in values.values()):raise ValueError('Settings cannot contain newlines.')
    check(values)
    env=ROOT/'.env';existing=env.read_text().splitlines() if env.exists() else []
    existing=[line for line in existing if line.split('=',1)[0] not in FIELDS]
    env.write_text('\n'.join(existing+[k+'='+values[k] for k in FIELDS])+'\n');os.chmod(env,0o600)
    print('Saved private SMTP settings. Restart CampusBite, then run the connection check. No messages sent.')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--diagnose',action='store_true');parser.add_argument('--configure',action='store_true');parser.add_argument('--umich',action='store_true');parser.add_argument('--check',action='store_true');parser.add_argument('--verify-connection',action='store_true')
    args=parser.parse_args()
    if args.configure:configure(args.umich);return
    settings=load()
    for field in FIELDS:print(field+': '+('configured' if settings.get(field) else 'missing'))
    check(settings,args.verify_connection or args.diagnose)
    print('PASS: '+('encrypted SMTP login verified; no email sent.' if args.verify_connection else 'configuration validated; no email sent.'))
if __name__=='__main__':
    try:main()
    except (ValueError,KeyboardInterrupt) as error:raise SystemExit(str(error))
