import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

function Fixture() {
  const [account, setAccount] = useState('');
  const [accepted, setAccepted] = useState(0);
  const [refused, setRefused] = useState(0);
  const [applied, setApplied] = useState('waiting');
  useEffect(() => window.fixture.state({ account, accepted, refused, applied }), [account, accepted, refused, applied]);
  return <main>
    <h1>DeskPilot offline React fixture</h1>
    <p>No account or business service is connected.</p>
    <label>Account <input id="account" value={account} onChange={event => {
      setAccount(event.target.value); setAccepted(value => value + 1);
    }}/></label>
    <p>State: {account}</p>
    <label>Refused input <input id="refused" value="" onChange={() => setRefused(value => value + 1)}/></label>
    <button onClick={() => setApplied(account)}>Apply fixture</button>
    <p>Result: {applied}</p>
    <label>User-only password <input id="password" type="password"/></label>
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
