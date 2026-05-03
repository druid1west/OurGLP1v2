import React, { useState } from 'react';
import modalStyles from './InjectionModal.module.css';

export interface Injection {
  id: number;
  injection_time: string;
  medication_name: string;
  medication_dose: string;
}

interface Props {
  time: string;
  injection: Injection | null;
  onSave: (name: string, dose: string) => void;
  onClose: () => void;
}

// Predefined lists
const medications = [
  'Ozempic',
  'Trulicity',
  'Mounjaro',
  'Bydureon',
  'Rybelsus',
  'Wegovy'
];

const doses: Record<string, string[]> = {
  Ozempic: ['0.25 mg', '0.5 mg', '1 mg'],
  Trulicity: ['0.75 mg', '1.5 mg'],
  Mounjaro: ['2.5 mg', '5 mg', '7.5 mg', '10 mg'],
  Bydureon: ['2 mg'],
  Rybelsus: ['3 mg', '7 mg', '14 mg'],
  Wegovy: ['0.25 mg', '0.5 mg', '1 mg', '1.7 mg', '2.4 mg'],
};

const InjectionModal: React.FC<Props> = ({ time, injection, onSave, onClose }) => {
  const initialMed = injection?.medication_name || medications[0];
  const initialDose = injection?.medication_dose || doses[initialMed][0];

  const [medName, setMedName] = useState<string>(initialMed);
  const [medDose, setMedDose] = useState<string>(initialDose);

  // Update dose options when medication changes
  const handleMedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMed = e.target.value;
    setMedName(newMed);
    // reset dose to first option for new medication
    setMedDose(doses[newMed][0]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(medName, medDose);
  };

  return (
    <div className={modalStyles.overlay}>
      <div className={modalStyles.modal}>
        <h2>{injection ? 'Edit' : 'Schedule'} Injection @ {time}</h2>
        <form onSubmit={handleSubmit}>
          <label>
            Medication:
            <select value={medName} onChange={handleMedChange}>
              {medications.map(med => (
                <option key={med} value={med}>{med}</option>
              ))}
            </select>
          </label>
          <label>
            Dose:
            <select value={medDose} onChange={e => setMedDose(e.target.value)}>
              {doses[medName].map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <button 
  type="submit" 
  style={{
    padding: '10px 20px', 
    width: '48%', 
    marginRight: '4%', 
    backgroundColor: '#4CAF50', 
    color: 'white', 
    border: 'none', 
    borderRadius: '4px',
    cursor: 'pointer'
  }}
>
  Save
</button>

<button 
  type="button" 
  onClick={onClose} 
  style={{
    padding: '10px 20px', 
    width: '48%', 
    backgroundColor: '#f44336', 
    color: 'white', 
    border: 'none', 
    borderRadius: '4px',
    cursor: 'pointer'
  }}
>
  Cancel
</button>
        </form>
      </div>
    </div>
  );
};

export default InjectionModal;
