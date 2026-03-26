"use client";

import { useState, useEffect } from 'react';
import { loginAction, fetchDataAction, fetchPublicDataAction } from './actions';

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);
  };

  useEffect(() => {
    addLog('Page Loaded: Registering device with DPoP tracking automatically...');
    fetchPublicDataAction().then(res => {
      if (res.success) {
        const deviceId = res.data.device_ID || res.data.Device_ID || 'Unknown';
        addLog(`Device automatically tracked: ${deviceId}`);
      } else {
        addLog(`Device tracking failed: ${res.error}`);
      }
    });
  }, []);

  const handleLogin = async () => {
    try {
      addLog('Calling Next.js Server Action: loginAction()...');
      addLog('Notice: The browser has NO access to the DPoP KeyPair or Access Token.');
      
      const res = await loginAction();
      
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
    try {
      addLog('Calling Next.js Server Action: fetchDataAction()...');
      
      const res = await fetchDataAction();
      
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
    try {
      addLog('Calling Next.js Server Action: fetchPublicDataAction()...');
      addLog('Notice: Making an unauthenticated request. DPoP will act as a device tracker.');
      
      const res = await fetchPublicDataAction();
      
      if (!res.success) {
        addLog(`Server Action Fetch Failed: ${res.error}`);
        return;
      }
      
      addLog(`Data Received: ${JSON.stringify(res.data)}`);
    } catch (err: unknown) {
      addLog(`Fetch Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24 bg-gray-900 text-white">
      <div className="z-10 w-full max-w-5xl items-center justify-between font-mono text-sm lg:flex">
        <h1 className="text-4xl font-bold mb-8 text-blue-400">DPoP Security Demo (BFF Pattern)</h1>
      </div>

      <div className="flex flex-col gap-4 w-full max-w-2xl bg-gray-800 p-8 rounded-xl shadow-lg border border-gray-700">
        <div className="flex justify-between items-center mb-6">
          <p className="text-gray-300">
            <strong>Server-Side DPoP Setup:</strong> Tokens and keys are stored in secure HttpOnly cookies on the Next.js server. The browser cannot access them (preventing XSS extraction).
          </p>
        </div>

        <div className="flex gap-4">
          <button 
            onClick={handleLogin}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 mx-2 rounded-lg transition-colors shadow-md shadow-blue-900/50"
          >
            1. Login via Server
          </button>
          <button 
            onClick={handleFetchData}
            disabled={!isLoggedIn}
            className={`flex-1 font-bold py-3 mx-2 rounded-lg transition-colors shadow-md ${!isLoggedIn ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500 text-white shadow-green-900/50'}`}
          >
            2. Fetch Data via Server
          </button>
        </div>
        
        <div className="flex gap-4 mt-2">
          <button 
            onClick={handleFetchPublicData}
            className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 mx-2 rounded-lg transition-colors shadow-md shadow-purple-900/50"
          >
            3. Fetch Public Data (Device Tracked)
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
