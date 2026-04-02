# Tamil RC Bible App – Quick Start Guide (Beginners)

Welcome! This guide will help you set up and run the **Tamil RC Bible** project on your local computer.

## 📋 Prerequisites
Before you start, make sure you have the following installed:

1.  **Node.js**: This is the engine that runs the application. 
    *   [Download it here](https://nodejs.org/) (Choose the "LTS" version).
2.  **Web Browser**: Chrome, Edge, or Firefox.

---

## 🚀 Step-by-Step Installation

### Step 1: Open the Project Folder
Open the folder where you have this project saved (e.g., `Tamil_rc_75_json`).

### Step 2: Open a Terminal
*   **Windows**: Click on the address bar at the top of the folder window, type `cmd`, and press **Enter**.
*   **Alternative**: Right-click in the folder and select "Open in Terminal" or "Open PowerShell here".

### Step 3: Install Required Dependencies
In the terminal window, type the following command and press **Enter**:
```bash
npm install
```
*Wait for it to finish. This will create a `node_modules` folder and install all the necessary tools (Express, CORS, Dotenv, etc.).*

### Step 4: Configure the Environment
Ensure there is a file named `.env` in the root folder. It should look like this (if it's not there, create it):
```text
PORT=3001
GEMINI_API_KEY=your_api_key_here
```
*(The `GEMINI_API_KEY` is required for the AI chat features to work).*

### Step 5: Start the Project
In the same terminal, type this command:
```bash
npm run dev
```
*You should see a message saying `Server running on http://localhost:3001`.*

### Step 6: View the Application
Open your web browser and go to:
**[http://localhost:3001](http://localhost:3001)**

---

## 🛠️ Commands Summary
*   `npm install`: Installs the required libraries.
*   `npm run dev`: Starts the project in "Development Mode" (auto-restarts when you change code).
*   `npm start`: Starts the project in "Production Mode".

## 📦 Dependencies Used
These are the core libraries this project relies on:
- **Express**: The web server framework.
- **CORS**: Allows the frontend to communicate with the backend.
- **Dotenv**: Manages your secret API keys securely.
- **Google Generative AI**: Powers the "Ask Bible" AI feature.
- **Nodemon**: Automatically restarts the server during development.

---
**Enjoy exploring the Tamil Bible!** 📖✝️
