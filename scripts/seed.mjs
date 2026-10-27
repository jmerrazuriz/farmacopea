import { db } from '../src/db.mjs';
import { importDrug } from '../src/openfda.mjs';

const DRUGS = [
  'acetaminophen', 'ibuprofen', 'naproxen', 'aspirin', 'diclofenac', 'ketorolac', 'celecoxib', 'tramadol',
  'morphine', 'oxycodone', 'fentanyl', 'codeine', 'gabapentin', 'pregabalin',
  'amoxicillin', 'amoxicillin and clavulanate', 'azithromycin', 'ciprofloxacin', 'levofloxacin', 'doxycycline',
  'cephalexin', 'ceftriaxone', 'clarithromycin', 'metronidazole', 'trimethoprim and sulfamethoxazole', 'clindamycin',
  'vancomycin', 'fluconazole', 'acyclovir',
  'warfarin', 'apixaban', 'rivaroxaban', 'clopidogrel', 'heparin', 'enoxaparin',
  'atorvastatin', 'simvastatin', 'rosuvastatin', 'amlodipine', 'lisinopril', 'enalapril', 'losartan', 'valsartan',
  'metoprolol', 'atenolol', 'carvedilol', 'propranolol', 'hydrochlorothiazide', 'furosemide', 'spironolactone',
  'digoxin', 'amiodarone', 'diltiazem', 'verapamil', 'nitroglycerin',
  'metformin', 'glipizide', 'insulin glargine', 'insulin lispro', 'sitagliptin', 'empagliflozin', 'levothyroxine',
  'prednisone', 'dexamethasone', 'methylprednisolone',
  'omeprazole', 'pantoprazole', 'ranitidine', 'ondansetron', 'metoclopramide',
  'sertraline', 'fluoxetine', 'escitalopram', 'citalopram', 'venlafaxine', 'bupropion', 'amitriptyline', 'trazodone',
  'alprazolam', 'lorazepam', 'diazepam', 'clonazepam', 'zolpidem', 'haloperidol', 'quetiapine', 'olanzapine',
  'risperidone', 'lithium carbonate', 'lamotrigine', 'levetiracetam', 'carbamazepine', 'phenytoin', 'valproic acid',
  'salbutamol', 'albuterol', 'montelukast', 'loratadine', 'cetirizine', 'diphenhydramine',
  'allopurinol', 'colchicine', 'methotrexate', 'sildenafil', 'tamsulosin', 'ketoconazole', 'rifampin', 'potassium chloride',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv.slice(2);
const list = only.length ? only : DRUGS;
const delay = process.env.OPENFDA_API_KEY ? 100 : 400; // sin clave: 240 peticiones/min

let ok = 0;
const missing = [];
for (const [i, name] of list.entries()) {
  try {
    const id = await importDrug(name);
    if (id) ok++;
    else missing.push(name);
    console.log(`[${i + 1}/${list.length}] ${id ? 'OK ' : 'NO '} ${name}`);
  } catch (e) {
    missing.push(name);
    console.log(`[${i + 1}/${list.length}] ERR ${name}: ${e.message}`);
    if (/429/.test(e.message)) await sleep(15000);
  }
  await sleep(delay);
}
const total = db.prepare('SELECT COUNT(*) AS n FROM drugs').get().n;
console.log(`\nImportados: ${ok}/${list.length}. Total en la base: ${total}.`);
if (missing.length) console.log(`Sin resultado: ${missing.join(', ')}`);
