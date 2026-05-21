"use client";

import { useState, useEffect } from 'react';
import { loginAction, fetchDataAction, fetchPublicDataAction, fetchCustomPublicDataAction } from './actions';
import { createClientProof, clearClientKey } from './lib/client-crypto';
import { useBotProtection } from '../components/BotProtectionProvider';

const API_URL = "http://localhost:5083";

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const { isBotDetected, detectionReasons } = useBotProtection();

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);
  };

  useEffect(() => {
    if (detectionReasons.length > 0) {
      addLog(`🚨 Bot detector tripped! New reason flagged: ${detectionReasons[detectionReasons.length - 1]}`);
    }
  }, [detectionReasons]);

  useEffect(() => {
    addLog('Page Loaded: Registering device with hardware-bound DPoP tracking...');
    // Create proof for the GraphQL endpoint
    createClientProof("POST", `${API_URL}/graphql`).then(proof => {
      fetchPublicDataAction(proof).then(res => {
        if (res.success) {
          const deviceId = res.data.device_ID || res.data.Device_ID || 'Unknown';
          addLog(`Device automatically tracked (Browser Native Key): ${deviceId}`);
        } else {
          addLog(`Device tracking failed: ${res.error}`);
        }
      });
    }).catch(err => {
      addLog(`Failed to create proof: ${err}`);
    });
  }, []);

  const handleLogin = async () => {
    if (isBotDetected) {
      addLog(`Action blocked by Anti-Bot System. Reasons: ${detectionReasons.join(", ")}`);
      return;
    }
    try {
      addLog('Generating Hardware-Bound DPoP Proof for Login (GraphQL)...');
      const proof = await createClientProof("POST", `${API_URL}/graphql`);
      addLog(`Proof Generated: ${proof.substring(0, 30)}... (Notice how the signature changes every time!)`);
      
      addLog('Calling Next.js Server Action: loginAction()...');
      const res = await loginAction(proof);
      
      if (!res.success) {
        addLog(`Server Action Login Failed: ${res.error}`);
        return;
      }
      
      setIsLoggedIn(true);
      addLog(res.message || 'Login Success!');
    } catch (err: unknown) {
      addLog(`Login Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleFetchData = async () => {
    if (isBotDetected) {
      addLog(`Action blocked by Anti-Bot System. Reasons: ${detectionReasons.join(", ")}`);
      return;
    }
    try {
      addLog('Generating Hardware-Bound DPoP Proof for Fetching Data...');
      const proof = await createClientProof("POST", `${API_URL}/graphql`);
      addLog(`Proof Generated: ${proof.substring(0, 30)}... (Notice how the signature changes every time!)`);

      addLog('Calling Next.js Server Action: fetchDataAction()...');
      const res = await fetchDataAction(proof);
      
      if (!res.success) {
        addLog(`Server Action Fetch Failed: ${res.error}`);
        return;
      }
      
      addLog(`Data Received from Node Server: ${JSON.stringify(res.data)}`);
    } catch (err: unknown) {
      addLog(`Fetch Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleFetchPublicData = async () => {
    if (isBotDetected) {
      addLog(`Action blocked by Anti-Bot System. Reasons: ${detectionReasons.join(", ")}`);
      return;
    }
    try {
      addLog('Generating Hardware-Bound DPoP Proof for Public Data...');
      const proof = await createClientProof("POST", `${API_URL}/graphql`);
      addLog(`Proof Generated: ${proof.substring(0, 30)}... (Notice how the signature changes every time!)`);

      addLog('Calling Next.js Server Action: fetchPublicDataAction()...');
      const res = await fetchPublicDataAction(proof);
      
      if (!res.success) {
        addLog(`Server Action Fetch Failed: ${res.error}`);
        return;
      }
      
      const deviceId = res.data.device_ID || res.data.Device_ID || 'Unknown';
      addLog(`Data Received. .NET Server confirms this is Device Thumbprint: ${deviceId}`);
    } catch (err: unknown) {
      addLog(`Fetch Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleClearKey = async () => {
    try {
      await clearClientKey();
      setIsLoggedIn(false);
      addLog('⚠️ Hardware Key Destroyed from IndexedDB. You are now a brand new device.');
      addLog('If you click Fetch Public Data now, a new key will be generated and you will get a new Thumbprint.');
    } catch (err) {
      addLog(`Failed to clear key: ${err}`);
    }
  };

  const handleFetchMultiple = async () => {
    if (isBotDetected) {
      addLog(`Action blocked by Anti-Bot System. Reasons: ${detectionReasons.join(", ")}`);
      return;
    }
    addLog('--- Starting Multiple Requests (Different GraphQL Queries) ---');
    const queries = [
      "publicWeather",
      "apiWeather",
      "apiTemperature"
    ];

    for (let i = 0; i < queries.length; i++) {
      const queryName = queries[i];
      addLog(`Target: GraphQL Query '${queryName}'`);
      
      // We must sign the EXACT URL we are hitting! Now it's always /graphql
      const proof = await createClientProof("POST", `${API_URL}/graphql`);
      addLog(`Generated Proof: ${proof.substring(0, 25)}...`);
      
      const res = await fetchCustomPublicDataAction(proof, queryName);
      if (res.success) {
        const deviceId = res.data?.device_ID || res.data?.Device_ID || 'Unknown';
        addLog(`Success. Tracking Thumbprint: ${deviceId}`);
      } else {
        addLog(`Failed: ${res.error}.`);
      }
    }
    addLog('Notice: The Browser signed the same URL multiple times but fetched different data!');
    addLog('--- End Multiple Requests Test ---');
  };

  const handleFetchApiWeather = async () => {
    if (isBotDetected) {
      addLog(`Action blocked by Anti-Bot System. Reasons: ${detectionReasons.join(", ")}`);
      return;
    }
    try {
      addLog('--- Fetching API Weather ---');
      await clearClientKey();
      addLog('Cleared existing DPoP key to generate a new one.');
      const proof = await createClientProof("POST", `${API_URL}/graphql`);
      addLog(`New DPoP Proof Generated: ${proof.substring(0, 30)}...`);

      const res = await fetchCustomPublicDataAction(proof, "apiWeather");
      if (res.success) {
        const deviceId = res.data.device_ID || res.data.Device_ID || 'Unknown';
        addLog(`Weather Data: ${res.data.Data} | New Thumbprint: ${deviceId}`);
      } else {
        addLog(`Failed: ${res.error}`);
      }
    } catch (err: unknown) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleFetchApiTemperature = async () => {
    if (isBotDetected) {
      addLog(`Action blocked by Anti-Bot System. Reasons: ${detectionReasons.join(", ")}`);
      return;
    }
    try {
      addLog('--- Fetching API Temperature ---');
      await clearClientKey();
      addLog('Cleared existing DPoP key to generate a new one.');
      const proof = await createClientProof("POST", `${API_URL}/graphql`);
      addLog(`New DPoP Proof Generated: ${proof.substring(0, 30)}...`);

      const res = await fetchCustomPublicDataAction(proof, "apiTemperature");
      if (res.success) {
        const deviceId = res.data.device_ID || res.data.Device_ID || 'Unknown';
        addLog(`Temperature Data: ${res.data.Data} | New Thumbprint: ${deviceId}`);
      } else {
        addLog(`Failed: ${res.error}`);
      }
    } catch (err: unknown) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleFetchApiSeason = async () => {
    if (isBotDetected) {
      addLog(`Action blocked by Anti-Bot System. Reasons: ${detectionReasons.join(", ")}`);
      return;
    }
    try {
      addLog('--- Fetching API Season ---');
      await clearClientKey();
      addLog('Cleared existing DPoP key to generate a new one.');
      const proof = await createClientProof("POST", `${API_URL}/graphql`);
      addLog(`New DPoP Proof Generated: ${proof.substring(0, 30)}...`);

      const res = await fetchCustomPublicDataAction(proof, "apiSeason");
      if (res.success) {
        const deviceId = res.data.device_ID || res.data.Device_ID || 'Unknown';
        addLog(`Season Data: ${res.data.Data} | New Thumbprint: ${deviceId}`);
      } else {
        addLog(`Failed: ${res.error}`);
      }
    } catch (err: unknown) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24 bg-gray-900 text-white">
      <div className="z-10 w-full max-w-5xl items-center justify-between font-mono text-sm lg:flex">
        <h1 className="text-4xl font-bold mb-8 text-blue-400">DPoP Security Demo (Hardware-Bound)</h1>
      </div>

      <div className="flex flex-col gap-4 w-full max-w-2xl bg-gray-800 p-8 rounded-xl shadow-lg border border-gray-700">
        <div className="flex justify-between items-center mb-6">
          <p className="text-gray-300">
            <strong>Client-Side DPoP Setup:</strong> Private keys are generated natively in your browser with <code className="bg-gray-700 px-1 rounded">extractable: false</code>. Proofs are signed in the browser and passed to the server!
          </p>
        </div>

        <div className="flex gap-4">
          <button 
            onClick={handleLogin}
            disabled={isBotDetected}
            className={`flex-1 font-bold py-3 mx-2 rounded-lg transition-colors shadow-md ${isBotDetected ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/50'}`}
          >
            1. Login
          </button>
          <button 
            onClick={handleFetchData}
            disabled={!isLoggedIn || isBotDetected}
            className={`flex-1 font-bold py-3 mx-2 rounded-lg transition-colors shadow-md ${(!isLoggedIn || isBotDetected) ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500 text-white shadow-green-900/50'}`}
          >
            2. Fetch Secure Data
          </button>
        </div>
        
        <div className="flex gap-4 mt-2">
          <button 
            onClick={handleFetchPublicData}
            disabled={isBotDetected}
            className={`flex-1 font-bold py-3 mx-2 rounded-lg transition-colors shadow-md ${isBotDetected ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/50'}`}
          >
            3. Fetch Public Data (Single)
          </button>
          <button 
            onClick={handleFetchMultiple}
            disabled={isBotDetected}
            className={`flex-1 font-bold py-3 mx-2 rounded-lg transition-colors shadow-md ${isBotDetected ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-900/50'}`}
          >
            4. Fetch Multiple (Diff Queries)
          </button>
        </div>

        <div className="flex gap-4 mt-2">
          <button 
            onClick={handleFetchApiWeather}
            disabled={isBotDetected}
            className={`flex-1 font-bold py-3 mx-2 rounded-lg transition-colors shadow-md text-sm ${isBotDetected ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-yellow-600 hover:bg-yellow-500 text-white shadow-yellow-900/50'}`}
          >
            5. Weather API (New Key)
          </button>
          <button 
            onClick={handleFetchApiTemperature}
            disabled={isBotDetected}
            className={`flex-1 font-bold py-3 mx-2 rounded-lg transition-colors shadow-md text-sm ${isBotDetected ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-500 text-white shadow-orange-900/50'}`}
          >
            6. Temperature API (New Key)
          </button>
          <button 
            onClick={handleFetchApiSeason}
            disabled={isBotDetected}
            className={`flex-1 font-bold py-3 mx-2 rounded-lg transition-colors shadow-md text-sm ${isBotDetected ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-teal-600 hover:bg-teal-500 text-white shadow-teal-900/50'}`}
          >
            7. Season API (New Key)
          </button>
        </div>

        <div className="flex gap-4 mt-6 pt-6 border-t border-gray-700">
          <button 
            onClick={handleClearKey}
            className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 mx-2 rounded-lg transition-colors shadow-md shadow-red-900/50"
          >
            🚨 Simulate New Device (Destroy Hardware Key)
          </button>
        </div>
      </div>

      <div className="mt-8 w-full max-w-4xl max-h-96">
        <h3 className="text-xl mb-4 font-semibold text-gray-400">Activity Logs</h3>
        <div className="bg-black p-4 rounded-lg overflow-y-auto h-64 border border-gray-800 font-mono text-xs text-green-400">
          {logs.map((log, i) => (
            <div key={i} className="mb-1">{log}</div>
          ))}
          {logs.length === 0 && <span className="text-gray-600">No activity yet...</span>}
        </div>
      </div>
    </main>
  );
}
