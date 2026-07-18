import json
import os
import sys
import time

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


def emit(success, message):
    print(json.dumps({"success": success, "message": message}), flush=True)


def setup_driver():
    options = webdriver.ChromeOptions()
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--window-size=1440,1200")

    if os.environ.get("VERIFY_HEADLESS", "false").lower() == "true":
        options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")

    chrome_bin = os.environ.get("CHROME_BIN")
    if chrome_bin:
        options.binary_location = chrome_bin

    driver_path = os.environ.get("CHROMEDRIVER_PATH")
    service = Service(driver_path) if driver_path else Service()
    return webdriver.Chrome(service=service, options=options)


def close_popup_if_present(driver):
    try:
        WebDriverWait(driver, 5, poll_frequency=0.5).until(
            EC.element_to_be_clickable((By.XPATH, "//button[contains(text(),'Close')]"))
        ).click()
    except Exception:
        pass


def login(driver, email, password):
    driver.get("https://seller.flipkart.com/")
    close_popup_if_present(driver)

    WebDriverWait(driver, 15, poll_frequency=1).until(
        EC.element_to_be_clickable((By.XPATH, "//button[text()='Login']"))
    ).click()
    WebDriverWait(driver, 15, poll_frequency=1).until(
        EC.presence_of_element_located((By.XPATH, "//input[@type='text']"))
    ).send_keys(email, Keys.RETURN)
    time.sleep(1)
    WebDriverWait(driver, 15, poll_frequency=1).until(
        EC.presence_of_element_located((By.XPATH, "//input[@type='password']"))
    ).send_keys(password, Keys.RETURN)


def verify_login(driver):
    success_conditions = [
        (By.CSS_SELECTOR, "input[placeholder*='Search by']"),
        (By.XPATH, "//*[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'dashboard')]"),
        (By.XPATH, "//*[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'listings')]"),
    ]

    deadline = time.time() + 35
    while time.time() < deadline:
        for by, locator in success_conditions:
            if driver.find_elements(by, locator):
                return True, "Flipkart seller login verified."

        page_text = driver.find_element(By.TAG_NAME, "body").text.lower()
        if "invalid" in page_text or "incorrect" in page_text:
            return False, "Flipkart rejected the supplied credentials."
        if "otp" in page_text or "verification" in page_text or "captcha" in page_text:
            return False, "Flipkart requires additional verification before this account can be connected."

        time.sleep(1)

    return False, "Flipkart login could not be verified before timeout."


def main():
    email = os.environ.get("FK_VERIFY_EMAIL")
    password = os.environ.get("FK_VERIFY_PASSWORD")

    if not email or not password:
        emit(False, "Flipkart seller email and password are required.")
        return 1

    driver = None
    try:
        driver = setup_driver()
        login(driver, email, password)
        success, message = verify_login(driver)
        emit(success, message)
        return 0 if success else 1
    except Exception as exc:
        emit(False, f"Flipkart verification failed: {exc.__class__.__name__}")
        return 1
    finally:
        if driver:
            driver.quit()


if __name__ == "__main__":
    sys.exit(main())
