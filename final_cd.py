import time
import datetime
import pandas as pd
import logging
import sys
import os
import argparse
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

def parse_args():
    parser = argparse.ArgumentParser(description="Flipkart product latching automation")
    parser.add_argument("legacy_csv", nargs="?", help="CSV file path for backward compatibility")
    parser.add_argument("--csv", dest="csv_file", help="CSV file path")
    parser.add_argument("--email", dest="email", help="Flipkart seller email")
    parser.add_argument("--password", dest="password", help="Flipkart seller password")
    return parser.parse_args()

ARGS = parse_args()
CSV_FILE = ARGS.csv_file or ARGS.legacy_csv
if not CSV_FILE:
    print("CSV file path is required.")
    sys.exit(1)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REPORT_DIR = os.environ.get("REPORT_DIR", os.path.join(BASE_DIR, "reports"))
os.makedirs(REPORT_DIR, exist_ok=True)

# Flipkart credentials
EMAIL = ARGS.email or os.environ.get("LATCHING_SELLER_EMAIL")
PASSWORD = ARGS.password or os.environ.get("LATCHING_SELLER_PASSWORD")

if not EMAIL or not PASSWORD:
    print("Flipkart seller credentials are required.")
    sys.exit(1)

# Logging setup
LOG_FILE = "flipkart_autofill.log"
logging.basicConfig(
    filename=LOG_FILE,
    filemode='a',
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    level=logging.INFO
)
logger = logging.getLogger()
logger.addHandler(logging.StreamHandler())

logger.info("FK Latching Automation")

def load_data(file_path):
    extension = os.path.splitext(file_path)[1].lower()
    if extension == ".xlsx":
        data = pd.read_excel(file_path, engine="openpyxl")
    else:
        data = pd.read_csv(file_path)
    data.columns = data.columns.str.strip().str.upper()
    return data

def setup_driver():
    options = webdriver.ChromeOptions()
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--window-size=1440,1200")

    if os.environ.get("SELENIUM_HEADLESS", "false").lower() == "true":
        options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
    else:
        options.add_argument("--start-maximized")

    chrome_bin = os.environ.get("CHROME_BIN")
    if chrome_bin:
        options.binary_location = chrome_bin

    driver_path = os.environ.get("CHROMEDRIVER_PATH")
    service = Service(driver_path) if driver_path else Service()
    driver = webdriver.Chrome(service=service, options=options)
    return driver

def login(driver):
    driver.get('https://seller.flipkart.com/')
    try:
        WebDriverWait(driver, 10, poll_frequency=0.5).until(EC.element_to_be_clickable((By.XPATH, "//button[contains(text(),'Close')]"))).click()
    except:
        pass

    WebDriverWait(driver, 10, poll_frequency=1).until(EC.element_to_be_clickable((By.XPATH, "//button[text()='Login']"))).click()
    WebDriverWait(driver, 10, poll_frequency=1).until(EC.presence_of_element_located((By.XPATH, "//input[@type='text']"))).send_keys(EMAIL, Keys.RETURN)
    time.sleep(1)
    WebDriverWait(driver, 10, poll_frequency=1).until(EC.presence_of_element_located((By.XPATH, "//input[@type='password']"))).send_keys(PASSWORD, Keys.RETURN)
    time.sleep(10)

def safe_send_keys(driver, by, locator, keys):
    try:
        elem = WebDriverWait(driver, 10, poll_frequency=0.5).until(EC.element_to_be_clickable((by, locator)))
        driver.execute_script("arguments[0].scrollIntoView(true);", elem)
        elem.click()
        elem.clear()
        elem.send_keys(str(keys))
        return True
    except Exception as e:
        logger.warning(f"Failed sending keys: {e}")
        return False

def safe_select_dropdown(driver, by, locator, value_to_select):
    try:
        dropdown = WebDriverWait(driver, 5, poll_frequency=0.5).until(EC.element_to_be_clickable((by, locator)))
        driver.execute_script("arguments[0].scrollIntoView(true);", dropdown)
        dropdown.click()
        time.sleep(1)

        if locator == "tax_code":
            dropdown.send_keys(value_to_select)
        else:
            dropdown.send_keys(value_to_select[:2])

        time.sleep(1)
        dropdown.send_keys(Keys.RETURN)
        time.sleep(1)
        logger.info(f"Selected '{value_to_select}' in dropdown")
        return True
    except Exception as e:
        logger.warning(f"Failed selecting dropdown: {e}")
        return False

def safe_close_popup_if_present(driver):
    try:
        popup_button = WebDriverWait(driver, 5, poll_frequency=1).until(EC.element_to_be_clickable((By.XPATH, "//button[contains(text(),'View the new page')]")))
        driver.execute_script("arguments[0].scrollIntoView(true);", popup_button)
        popup_button.click()
        logger.info("Popup closed successfully")
        time.sleep(1)
    except:
        logger.info("No popup appeared")

def find_and_click_start_selling(driver):
    xpath = ("//*[(self::button or self::a) and contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'start selling')]")
    elems = driver.find_elements(By.XPATH, xpath)
    if elems:
        elems[0].click()
        return True
    for frame in driver.find_elements(By.TAG_NAME, "iframe"):
        driver.switch_to.frame(frame)
        elems = driver.find_elements(By.XPATH, xpath)
        if elems:
            elems[0].click()
            driver.switch_to.default_content()
            return True
        driver.switch_to.default_content()
    return False

def fill_product_details(driver, row):
    field_mapping = {
        "SELLER SKU ID": (By.XPATH, "//input[contains(@name, 'sku_id')]"),
        "LISTING STATUS*": (By.ID, "listing_status"),
        "MRP*": (By.XPATH, "//input[contains(@name, 'mrp')]"),
        "YOUR SELLING PRICE*": (By.XPATH, "//input[contains(@name, 'flipkart_selling_price')]"),
        "MINIMUM ORDER QUANTITY (MINOQ)": (By.XPATH, "//select[contains(@name, 'minimum_order_quantity')]"),
        "FULLFILMENT BY*": (By.ID, "service_profile"),
        "PROCUREMENT TYPE*": (By.ID, "procurement_type"),
        "PROCUREMENT SLA*": (By.XPATH, "//input[contains(@name, 'shipping_days')]"),
        "STOCK*": (By.XPATH, "//input[contains(@name, 'stock_size')]"),
        "SHIPPING PROVIDER*": (By.ID, "shipping_provider"),
        "LENGTH": (By.XPATH, "//input[contains(@name,'length')]"),
        "BREADTH": (By.XPATH, "//input[contains(@name,'breadth')]"),
        "HEIGHT": (By.XPATH, "//input[contains(@name,'height')]"),
        "WEIGHT": (By.XPATH, "//input[contains(@name,'weight')]"),
        "HSN*": (By.XPATH, "//input[contains(@name, 'hsn')]"),
        "TAX CODE*": (By.ID, "tax_code"),
        "COUNTRY OF ORIGIN*": (By.ID, "country_of_origin")
    }

    for field, locator in field_mapping.items():
        value = row.get(field, "")
        if pd.isna(value) or value == "":
            continue
        if locator[1] in ("country_of_origin", "listing_status", "service_profile", "procurement_type", "shipping_provider", "tax_code"):
            safe_select_dropdown(driver, locator[0], locator[1], value)
        else:
            safe_send_keys(driver, locator[0], locator[1], value)
        time.sleep(0.5)

    safe_send_keys(driver, By.XPATH, "//textarea[contains(@name, 'manufacturer_details')]", "CASADITTA")
    safe_send_keys(driver, By.XPATH, "//textarea[contains(@name, 'packer_details')]", "CASADITTA")

    for attempt in range(5):
        try:
            submit_btn = WebDriverWait(driver, 10, poll_frequency=1).until(EC.element_to_be_clickable((By.XPATH, "//button[contains(text(),'Submit')]")))
            driver.execute_script("arguments[0].scrollIntoView(true);", submit_btn)
            submit_btn.click()
            logger.info(f"Submit clicked (Attempt {attempt+1})")
            time.sleep(2)

            try:
                driver.find_element(By.XPATH, "//button[contains(text(),'Submit')]")
                logger.warning(f"Submit button still present after attempt {attempt+1}")
            except:
                logger.info("Submit button disappeared after click.")
                return True
        except Exception as e:
            logger.warning(f"Submit attempt {attempt+1} failed: {e}")
            time.sleep(2)

    try:
        driver.find_element(By.XPATH, "//button[contains(text(),'Submit')]")
        logger.error("Submit failed after 5 attempts.")
        return False
    except:
        logger.info("Submit successful after retries.")
        return True

def main():
    data = load_data(CSV_FILE)
    driver = setup_driver()
    logs = []

    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    report_file = os.path.join(REPORT_DIR, f"latching_{timestamp}.csv")

    try:
        login(driver)
        logger.info("Login successful.")

        for idx, row in data.iterrows():
            fsn = row["FSN"]
            logger.info(f"Processing FSN={fsn}")

            try:
                search_box = WebDriverWait(driver, 10, poll_frequency=1).until(EC.presence_of_element_located((By.CSS_SELECTOR, "input[placeholder*='Search by']")))
                search_box.clear()
                search_box.send_keys(fsn, Keys.RETURN)
                logger.info("FSN entered")
                time.sleep(3)

                if not find_and_click_start_selling(driver):
                    raise Exception("Could not find 'Start Selling' button")

                logger.info("Clicked Start Selling")
                time.sleep(2)

                success = fill_product_details(driver, row)
                status = "Success" if success else "Failed"
            except Exception as e:
                logger.error(f"Error processing FSN {fsn}: {e}")
                status = "Failed"

            logs.append({"FSN": fsn, "Status": status})

            driver.get('https://seller.flipkart.com/index.html#dashboard/listingsInProgress')
            time.sleep(2)
            safe_close_popup_if_present(driver)

    finally:
        pd.DataFrame(logs).to_csv(report_file, index=False)
        logger.info(f"âœ… All done! Report saved at: {report_file}")
        driver.quit()

if __name__ == "__main__":
    main()


