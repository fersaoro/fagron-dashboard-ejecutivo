"""Genera 'ver_sin_servidor.html': una version autonoma del dashboard con
los datos, el logo y Chart.js incrustados dentro del mismo archivo, para
poder verla con doble clic sin subirla a ningun hosting.

No reemplaza a index.html + data.json (esa es la version que debe usar el
equipo dia a dia); esto es solo una copia de conveniencia para revisar.

Uso, desde la carpeta raiz del paquete (donde esta index.html):
    python3 data_pipeline/build_standalone.py
"""
import base64
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def build():
    html = open(os.path.join(BASE, 'index.html'), encoding='utf-8').read()
    css = open(os.path.join(BASE, 'css/styles.css'), encoding='utf-8').read()
    js = open(os.path.join(BASE, 'js/app.js'), encoding='utf-8').read()
    vendor = open(os.path.join(BASE, 'js/vendor/chart.umd.min.js'), encoding='utf-8').read()
    data_raw = open(os.path.join(BASE, 'data.json'), encoding='utf-8').read()
    data_safe = data_raw.replace('</', '<\\/')

    logo = base64.b64encode(open(os.path.join(BASE, 'assets/logo.png'), 'rb').read()).decode()
    logob = base64.b64encode(open(os.path.join(BASE, 'assets/logo-blanco.png'), 'rb').read()).decode()

    html = html.replace('<link rel="stylesheet" href="css/styles.css">', f'<style>\n{css}\n</style>')
    html = html.replace('assets/logo-blanco.png', f'data:image/png;base64,{logob}')
    html = html.replace('assets/logo.png', f'data:image/png;base64,{logo}')
    html = html.replace('<script src="js/vendor/chart.umd.min.js"></script>', f'<script>\n{vendor}\n</script>')

    embedded = (
        f'<script id="embedded-data" type="application/json">{data_safe}</script>\n'
        '<script>\nwindow.__DASHBOARD_DATA__ = JSON.parse(document.getElementById("embedded-data").textContent);\n</script>\n'
        f'<script>\n{js}\n</script>'
    )
    html = html.replace('<script src="js/app.js"></script>', embedded)

    html = html.replace(
        '<main class="wrap">',
        '<main class="wrap"><div style="background:#ECEDED;color:#4B4B4B;padding:8px 16px;'
        'border-radius:8px;font-size:12.5px;margin:16px 0;">Version autonoma para ver con doble '
        'clic (datos incrustados). Para uso diario del equipo, usa index.html + data.json subidos '
        'al hosting.</div>'
    )

    out_path = os.path.join(BASE, 'ver_sin_servidor.html')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('Generado:', out_path, '(%.2f MB)' % (len(html) / 1024 / 1024))

if __name__ == '__main__':
    build()
