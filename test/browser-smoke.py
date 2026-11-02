from playwright.sync_api import sync_playwright
import json, os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
(ROOT/'artifacts').mkdir(exist_ok=True)
BASE=os.environ.get('BRIEF_TEST_URL','http://127.0.0.1:3000')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':1100},device_scale_factor=1)
 errors=[]
 page.on('pageerror',lambda e: errors.append(str(e)))
 page.goto(BASE)
 page.get_by_role('heading',name='Меньше переписки.').wait_for()
 page.screenshot(path=str(ROOT/'artifacts'/'landing-desktop.png'),full_page=True)
 page.get_by_role('button',name='Посмотреть демо').click()
 page.get_by_role('heading',name='Порядок в делах').wait_for()
 page.screenshot(path=str(ROOT/'artifacts'/'workspace-desktop.png'),full_page=True)
 page.get_by_role('button',name='Новый проект',exact=True).click()
 page.get_by_label('Название проекта').fill('Браузерный тест')
 page.get_by_label('Клиент / компания').fill('Browser Studio')
 page.get_by_label('Что сделаем').fill('Дизайн и разработка сайта. Два раунда правок.')
 page.get_by_label('Бюджет, ₽').fill('95000')
 page.locator('#project-form').get_by_role('button',name='Создать проект',exact=True).click()
 page.get_by_role('button',name='Br Браузерный тест Browser Studio').click()
 page.get_by_role('button',name='Создать ссылку клиенту').click()
 link=page.locator('#share-link').input_value()
 client=browser.new_page(viewport={'width':390,'height':844})
 client.goto(link)
 client.get_by_role('heading',name='Браузерный тест').wait_for()
 client.screenshot(path=str(ROOT/'artifacts'/'proposal-mobile.png'),full_page=True)
 client.get_by_role('checkbox').check()
 client.get_by_role('button',name='Принять предложение').click()
 client.get_by_text('Предложение принято',exact=False).wait_for()
 page.reload()
 page.get_by_role('button',name='Br Браузерный тест Browser Studio').click()
 page.get_by_text('Клиент принял это предложение. Условия зафиксированы.').wait_for()
 page.get_by_role('button',name='Закрыть',exact=True).click()
 page.set_viewport_size({'width':390,'height':844})
 page.screenshot(path=str(ROOT/'artifacts'/'workspace-mobile.png'),full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile overflow'
 page.get_by_role('button',name='Открыть меню').click()
 page.get_by_role('button',name='Выйти',exact=True).click()
 page.get_by_role('button',name='Посмотреть демо').wait_for()
 page.screenshot(path=str(ROOT/'artifacts'/'landing-mobile.png'),full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Landing overflow'
 assert not errors, errors
 print(json.dumps({'browser_errors':errors,'workflow':'demo -> create -> share -> client approval -> locked terms -> logout','mobile_overflow':False},ensure_ascii=False))
 browser.close()
