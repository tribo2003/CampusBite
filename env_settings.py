def env_value(value):
    value=value.strip()
    if len(value)>=2 and value[0]==value[-1] and value[0] in ('"', "'"):
        value=value[1:-1]
    return value

def smtp_password(host,password):
    return password.replace(' ','') if host.strip().lower()=='smtp.gmail.com' else password

def smtp_login(client,host,username,password):
    password=smtp_password(host,password)
    if host.strip().lower()=='smtp.gmail.com':
        client.ehlo_or_helo_if_needed()
        client.user=username
        client.password=password
        return client.auth('LOGIN',client.auth_login,initial_response_ok=False)
    return client.login(username,password)
