import { COMMISSIONS, DISCIPLINARY_COURSE, GROUNDS, HANDBOOK_REQUIREMENTS, HANDBOOK_RULES } from './handbook.js';

/**
 * Job descriptions for every department (staff and head of department) and management,
 * generated from the handbook rules plus each department's settings (shift, rate, payroll sheet).
 * Role text below is the default; admins can edit any of it per company.
 */

export type JobLevel = 'management' | 'head' | 'staff';
export interface JobRole {
  key: string;
  title: string;
  department: string | null;
  level: JobLevel;
  reportsTo: string | null;
  summary: string;
  duties: string[];
  kpis: string[];
  skills: string[];
  /** 1-based numbers of the handbook's disciplinary grounds that matter most for this job. */
  focusRules: number[];
}

/** How a role is drawn on the organizational chart. */
export type ChartTier = 'executive' | 'manager' | 'supervisor' | 'head' | 'team' | 'staff';

const r = (key: string, title: string, department: string | null, level: JobLevel, reportsTo: string | null, summary: string, duties: string[], kpis: string[], skills: string[], focusRules: number[]): JobRole =>
  ({ key, title, department, level, reportsTo, summary, duties, kpis, skills, focusRules });

/** Management, supervisors and teams on the company's organizational chart (ORG_CHART below places them). */
export const MANAGEMENT: JobRole[] = [
  r('ceo', 'Owner / CEO', null, 'management', null,
    'Owns Mega Dance Center and sets its direction; accountable for growth, brand and profitability, in line with the mission to create an international nightclub stage the Philippines is proud of.',
    ['Set yearly goals, budgets and the company objectives in the handbook.', 'Approve senior appointments, major investments and international DJ bookings.', 'Review weekly payroll totals, sales and profit with the GM / COO.', 'Protect the brand and the club’s reputation in Angeles City and abroad.', 'Champion the core values: outstanding service, honesty, respect, trust and teamwork.'],
    ['Profit against budget', 'Guest count and sales growth', 'Staff turnover', 'Brand reputation and reviews'],
    ['Business leadership', 'Hospitality and entertainment industry experience', 'Financial decision-making'], [11, 20]),
  r('coo', 'General Manager / COO', null, 'management', 'ceo',
    'Runs the business day to day through the managers and supervisors, and trains them on the 7-Step Management System so every team delivers measurable results.',
    ['Lead the Elite, S&L & Construction, Shift, Marketing and PG managers, the CEO PA / Admin and the supervisors.', 'Train heads of department and supervisors on the 7-Step Management System and check their daily reviews.', 'Approve schedules, head-count and the weekly payroll before cash release.', 'Set and enforce standard procedures, cash controls and the disciplinary process.', 'Review evaluations, categories, promotions and pay increases.', 'Resolve escalated guest and staff issues.'],
    ['Payroll cost per night vs. sales', 'Teams reviewed daily with the 7 steps', 'Share of Category 1–2 employees', 'Incidents and safety issues'],
    ['Operations management', 'People leadership and coaching', 'Cash and inventory controls'], [11, 13, 17]),
  r('elite', 'Elite Manager', null, 'management', 'coo',
    'Manages the Elite operation and its AC team.',
    ['Run the Elite area and the Elite AC team every night.', 'Set daily tasks and targets for the Elite AC team and review them with the 7 steps.', 'Control Elite revenue, costs and guest experience against plan.', 'Report results and issues to the GM / COO.'],
    ['Elite revenue vs. plan', 'Elite AC team categories', 'Guest feedback'], ['Hospitality management', 'Team leadership'], [11, 12, 21]),
  r('snl', 'S&L, Construction Manager', null, 'management', 'coo',
    'Manages the S&L systems and all construction and building works; oversees maintenance and the technical team with the supervisors.',
    ['Plan and supervise construction, renovation and building works.', 'Keep the S&L systems working with the Head Tech.', 'Plan preventive maintenance with the Head Maintenance.', 'Control project budgets, contractors and safety on site.'],
    ['Projects on time and on budget', 'Technical downtime', 'Safety incidents'], ['Construction and technical management', 'Budget control', 'Safety'], [16, 23, 27]),
  r('ga', 'CEO PA / Admin', 'Admin', 'management', 'coo',
    'Personal assistant to the CEO and head of administration: records, documents, timekeeping, payroll preparation and reception.',
    ['Manage the CEO’s calendar, communication and errands, including the CEO driver.', 'Collect and verify hiring requirements (NSO, NBI, Health ID, Barangay working ID) within 1 week of hire.', 'Maintain employee files and working-ID verification on the Employees List.', 'Prepare the weekly payroll from the time clock; release salaries against signed pay slips.', 'Keep leave request forms, medical certificates and disciplinary records.'],
    ['CEO tasks completed on time', 'Payroll accuracy and on-time payout', 'Complete employee files', 'IDs verified'],
    ['Administration and bookkeeping', 'Discretion and confidentiality', 'Philippine labor basics (SSS, PhilHealth, Pag-IBIG)'], [1, 2, 11, 20]),
  r('shift', 'Shift Manager', null, 'management', 'coo',
    'Runs the night shift through the Supervisors on Duty and the heads of department: staffing, service, bar, kitchen, cashiers and security. Validates overtime (the handbook’s Operations Manager role).',
    ['Prepare and post the weekly schedule; keep the right number of staff per department each night.', 'Lead the Supervisors on Duty and check their 7-step reviews of every head of department.', 'Validate overtime after department-head approval.', 'Take call-ins, leave requests and schedule swaps as Manager on Duty.', 'Run the pre-shift briefing during the 9–10 PM break.', 'Review lateness, absences and penalties every week before payroll.'],
    ['Schedule cost vs. plan', 'Attendance and punctuality', 'Orders and LD’s per server', 'Heads reviewed daily'],
    ['3+ years nightclub or bar operations', 'Leadership under pressure', 'Scheduling and labor-cost control'], [3, 5, 12, 18]),
  r('mem', 'Marketing Manager', null, 'management', 'coo',
    'Brings the guests: promotions, events, social media and design, with the marketing team (Dims and the designers).',
    ['Plan the weekly event calendar, themes and international DJ/DJane bookings.', 'Lead the marketing team: content, posters and designs.', 'Run promotions: guestlists, birthday packages, champagne and big-bottle promos.', 'Manage social media and partnerships.', 'Track guest count, reservations and promo results against plan.'],
    ['Guest count and reservations vs. plan', 'Promo package and champagne sales', 'Event ROI', 'Social media reach'],
    ['Event and artist management', 'Marketing and social media', 'Negotiation'], [20, 21, 26]),
  r('pg', 'PG Manager', null, 'management', 'coo',
    'Manages the MDC PG team and the Elite PG team.',
    ['Schedule and brief the MDC and Elite PG teams.', 'Set nightly targets and review each PG with the 7 steps.', 'Recruit and train new PGs.', 'Report PG results to the GM / COO.'],
    ['PG team results vs. plan', 'PG attendance', 'PG categories'], ['Team leadership', 'Hospitality and sales'], [13, 21, 25]),
  r('purch', 'Purchase & Day-time Supervisor', null, 'management', 'coo',
    'Runs purchasing and the day-time operation; supervises maintenance, inventory and housekeeping.',
    ['Buy supplies and stock against approved budgets; compare prices and suppliers.', 'Supervise the Head Maintenance, Head Inventory and Head Housekeeping.', 'Check deliveries, stock levels and day-time cleaning and repairs.', 'Review the three heads daily with the 7 steps.'],
    ['Purchase cost vs. plan', 'Stock variance', 'Club ready by call time'], ['Purchasing and negotiation', 'Organization'], [10, 11, 16]),
  r('trainsup', 'Tech, Models, Champagne, Training & Attendance Supervisor', null, 'management', 'coo',
    'Supervises the tech team, VIP hostesses and Champagne Girls, models and dancers, and runs training and attendance control.',
    ['Supervise the Head Tech, Head VIP Hostesses & Champagne Girls, Head Models and Head Dancers.', 'Run training for new staff and refresher training.', 'Control attendance: call time, lates, absences and leave.', 'Review the four heads daily with the 7 steps.'],
    ['Attendance and punctuality', 'Training completed', 'Show and service quality'], ['Training and coaching', 'Entertainment operations'], [3, 18, 19]),
  r('driver', 'CEO Driver', null, 'staff', 'ga',
    'Drives the CEO safely and on time, and runs errands as assigned by the CEO PA / Admin.',
    ['Drive the CEO safely and on schedule.', 'Keep the vehicle clean, fueled and maintained.', 'Run errands and deliveries assigned by the CEO PA.', 'Keep the CEO’s schedule and conversations confidential.'],
    ['On-time trips', 'Vehicle condition', 'Incidents'], ['Professional driver’s license', 'Knowledge of Angeles City and Clark', 'Discretion'], [9, 20, 23]),
  r('mkt', 'Marketing Team', null, 'staff', 'mem',
    'Dims and the designers: content, posters, videos and social media for the club.',
    ['Produce posters, videos and posts for every event.', 'Photograph and film events.', 'Keep the brand consistent across channels.', 'Deliver on the Marketing Manager’s weekly plan.'],
    ['Content delivered on time', 'Reach and engagement'], ['Graphic design and video', 'Social media'], [20]),
  r('eliteac', 'Elite AC Team', null, 'staff', 'elite',
    'The Elite AC team, led by the Elite Manager.',
    ['Work the Elite area to the Elite Manager’s standards.', 'Deliver the nightly tasks assigned.', 'Report guest issues immediately.'],
    ['Tasks completed', 'Guest feedback'], ['Hospitality'], [13, 21, 25]),
  r('mdcpg', 'MDC PG Team', null, 'staff', 'pg',
    'The MDC PG team, led by the PG Manager.',
    ['Work the floor to the PG Manager’s standards.', 'Engage guests professionally and reach nightly targets.', 'Follow call time and grooming standards.'],
    ['Nightly targets', 'Attendance'], ['Presentable', 'Confident with guests'], [13, 25, 26]),
  r('elitepg', 'Elite PG Team', null, 'staff', 'pg',
    'The Elite PG team, led by the PG Manager.',
    ['Work the Elite area to the PG Manager’s standards.', 'Engage guests professionally and reach nightly targets.', 'Follow call time and grooming standards.'],
    ['Nightly targets', 'Attendance'], ['Presentable', 'Confident with guests'], [13, 25, 26]),
];

interface DeptJobs { department: string; staff: JobRole; head: JobRole | null; headKey: string }

const dept = (department: string, headReportsTo: string, head: Omit<JobRole, 'key' | 'department' | 'level' | 'reportsTo'> | null, staff: Omit<JobRole, 'key' | 'department' | 'level' | 'reportsTo'>, headKey?: string): DeptJobs => {
  const hk = headKey ?? `head:${department}`;
  return {
    department, headKey: hk,
    head: head ? { ...head, key: hk, department, level: 'head', reportsTo: headReportsTo } : null,
    staff: { ...staff, key: `staff:${department}`, department, level: 'staff', reportsTo: hk },
  };
};
const j = (title: string, summary: string, duties: string[], kpis: string[], skills: string[], focusRules: number[]) => ({ title, summary, duties, kpis, skills, focusRules });

export const DEPARTMENT_JOBS: DeptJobs[] = [
  dept('Supervisors', 'shift', null, j('Supervisor on Duty',
    'Runs the floor each night for the Shift Manager: leads the heads of department and the servers, and acts as Manager on Duty when assigned.',
    ['Check attendance at the 8:30 PM call time and assign stations and tables.', 'Run the server briefing: promos, champagne and big-bottle packages, VIP reservations.', 'Watch service speed, order slips and guest satisfaction across all tables.', 'Approve server breaks, swaps and replacements; report no-shows.', 'Record orders, sales comms, LD’s and PO per server in the Servers tracker.', 'Review every head of department daily with the 7-Step Management System.'],
    ['Team orders and LD’s per night', 'Server attendance and punctuality', 'Guest complaints', 'Tracker completed daily'],
    ['2+ years as server or captain', 'Leadership and coaching', 'Cash and order-slip procedures'], [3, 5, 11, 12, 21]), 'shift'),
  dept('Admin', 'ga', null, j('Admin Staff',
    'Supports the General Admin with records, timekeeping, payroll and documents.',
    ['Encode employee records, contacts and IDs.', 'Check the fingerprint clock and log book daily; report missing time-outs.', 'Prepare leave requests, warnings and memos.', 'Help prepare the weekly payroll sheets and pay slips.', 'File hiring requirements and follow up missing documents.'],
    ['Records complete and up to date', 'Payroll prepared on time', 'Timekeeping exceptions resolved'],
    ['Computer literate (spreadsheets)', 'Attention to detail', 'Confidentiality'], [2, 11, 20]), 'ga'),
  dept('Cashiers', 'ga', j('Head Cashier',
    'Owns cash handling for the club: opening and closing funds, reconciliations and cashier supervision.',
    ['Issue and count cashier floats; supervise opening and closing counts.', 'Reconcile sales, card payments and guest checks with the POS each night.', 'Investigate variances and report them to the General Admin.', 'Train cashiers on cash, card and guest-check procedures.', 'Prepare the night’s cash turnover and deposit records.'],
    ['Cash variance (target ₱0)', 'Accurate nightly reports', 'Cashier errors'],
    ['Cash management experience', 'Integrity', 'POS and spreadsheets'], [10, 11, 20]),
    j('Cashier', 'Handles guest payments accurately and quickly at the cashier station.',
    ['Open the station with a counted float.', 'Process cash and card payments against guest checks.', 'Issue receipts and settle bills with servers.', 'Count and turn over cash at closing with the Head Cashier.', 'Report discrepancies immediately.'],
    ['Cash variance', 'Payment speed', 'Void and refund errors'], ['Basic math and cash handling', 'Honesty', 'Calm under pressure'], [10, 11])),
  dept('Bartenders', 'shift', j('Head Bartender',
    'Runs the 3 bars: drink quality, speed, stock and the bar team.',
    ['Plan bar stations and staffing per night.', 'Keep recipes, pours and presentation consistent.', 'Order and receive stock with the checkers; control breakage and waste.', 'Train bartenders on cocktails, champagne service and syringe shots.', 'Do the nightly bar inventory and report variances.'],
    ['Pour-cost / stock variance', 'Drink ticket times', 'Promo package and syringe shot sales'], ['Mixology', 'Inventory control', 'Team leadership'], [9, 10, 16]),
    j('Bartender', 'Prepares and serves drinks quickly and consistently at an assigned bar.',
    ['Set up the bar before duty: ice, garnish, glassware, mixers.', 'Prepare drinks to standard recipes and serve bottle and champagne orders.', 'Sell syringe shots and promo packages.', 'Keep the bar clean and report breakage.', 'Close and count bar stock at the end of duty.'],
    ['Drinks per hour', 'Stock variance', 'Upsells'], ['Bartending experience', 'Speed and hygiene', 'Friendly service'], [9, 10, 16])),
  dept('Kitchen', 'shift', j('Kitchen Head',
    'Leads the kitchen to serve the highest quality food safely and on time.',
    ['Plan the menu prep list and kitchen staffing.', 'Keep food safety, hygiene and temperature logs.', 'Order and receive ingredients; control food cost and waste.', 'Check every plate for quality before it leaves the kitchen.', 'Train kitchen staff and run cleaning schedules.'],
    ['Food cost %', 'Ticket times', 'Hygiene inspection results'], ['Culinary experience', 'Food safety', 'Cost control'], [10, 16, 23]),
    j('Kitchen Staff', 'Prepares and cooks food orders to standard.',
    ['Prepare ingredients before duty.', 'Cook orders to recipe and timing.', 'Keep the station clean and follow food-safety rules.', 'Store and label food properly.', 'Report equipment defects immediately.'],
    ['Ticket time', 'Food quality complaints', 'Waste'], ['Cooking experience', 'Health ID', 'Hygiene'], [10, 23, 25])),
  dept('Shisha', 'shift', j('Shisha Lead',
    'Runs shisha service: quality, safety and stock.',
    ['Prepare flavors, coals and equipment for the night.', 'Train shisha attendants on preparation and safe coal handling.', 'Control tobacco, coal and flavor stock.', 'Check smoking-area safety and ventilation.'],
    ['Shisha sales', 'Stock variance', 'Safety incidents'], ['Shisha preparation', 'Fire safety', 'Stock control'], [16, 22, 23]),
    j('Shisha Attendant', 'Prepares and serves shisha to guests safely.',
    ['Set up and clean pipes and bowls.', 'Prepare shisha to standard and change coals on time.', 'Serve and upsell flavors.', 'Follow fire-safety rules and report hazards.'],
    ['Service time', 'Guest feedback', 'Breakage'], ['Shisha experience', 'Safety awareness'], [22, 23, 27])),
  dept('Housekeeping', 'shift', j('Housekeeping Supervisor',
    'Keeps the club, toilets and back-of-house clean and ready every night.',
    ['Assign cleaning areas and checklists per shift.', 'Inspect toilets, VIP rooms and the floor during and after duty.', 'Order cleaning supplies and control usage.', 'Report damage and maintenance needs.'],
    ['Inspection scores', 'Toilet checks completed', 'Supply cost'], ['Housekeeping experience', 'Organization'], [16, 23, 25]),
    j('Housekeeper', 'Keeps assigned areas clean and stocked.',
    ['Clean toilets, floor, tables and VIP areas on schedule.', 'Restock toilet supplies.', 'Clear spills and broken glass immediately.', 'Turn in found items to the Manager on Duty.'],
    ['Area checklists done', 'Response time to spills'], ['Diligence', 'Honesty'], [10, 23, 25])),
  dept('Receptionist', 'ga', j('Reception Lead',
    'Runs the reception: reservations, guestlists and the first impression of the club.',
    ['Manage the reservation book and table assignments with the VIP hosts.', 'Check guestlists before 11 PM and record promoter credits.', 'Train receptionists on greeting and reservation procedures.', 'Report guest-count results nightly.'],
    ['Reservation accuracy', 'Guestlist records complete', 'Guest feedback at entrance'], ['Customer service', 'Organization'], [2, 20, 21]),
    j('Receptionist', 'Welcomes guests and handles reservations and guestlists at the entrance.',
    ['Greet guests and check reservations.', 'Record guestlist arrivals before 11 PM for promoter commissions.', 'Assign tables per the floor plan and consumable rules.', 'Answer calls and messages for bookings.'],
    ['Guest wait time', 'Reservation errors'], ['Friendly and presentable', 'Good communication'], [20, 21, 26])),
  dept('Promoters', 'mem', j('Head Promoter',
    'Leads the promoter team to fill the club with the right guests every night.',
    ['Set weekly guestlist targets per promoter.', 'Plan promotions with the Marketing & Entertainment Manager.', 'Verify guestlist counts with reception for commission.', 'Coach promoters on guest invitations and conduct.'],
    ['Guests from guestlists per week', 'Advance table reservations', 'Promoter retention'], ['Network in Angeles City', 'Social media', 'Leadership'], [2, 20, 21]),
    j('Promoter', 'Invites guests and fills tables, earning guestlist and table commissions.',
    ['Build guestlists and send them to reception before the night.', 'Bring guests before 11 PM.', 'Secure advance table reservations.', 'Promote events on social media.'],
    ['Guests per week', 'Reservations made'], ['Outgoing personality', 'Social network'], [2, 21])),
  dept('Bouncers', 'shift', j('Head of Security',
    'Keeps guests, staff and property safe; leads the bouncer team.',
    ['Post bouncers at entrances, bars, VIP and exits.', 'Check IDs, dress code and capacity at the door.', 'Handle incidents calmly and report them in writing.', 'Run emergency and evacuation drills.', 'Check staff use of the approved entrance.'],
    ['Incidents per month', 'Response time', 'Incident reports filed'], ['Security experience', 'Conflict de-escalation', 'First aid'], [7, 8, 17, 24]),
    j('Security Guard (Bouncer)', 'Protects guests, staff and property at an assigned post.',
    ['Check IDs and dress code at the door.', 'Watch the floor and prevent fights and theft.', 'Escort intoxicated or unruly guests out safely.', 'Report every incident to the Head of Security.'],
    ['Incidents prevented', 'Post coverage'], ['Physically fit', 'Calm and respectful'], [7, 8, 17])),
  dept('Servers', 'staff:Supervisors', j('Head Server',
    'Leads the servers on the floor: stations, service standards, order slips and sales.',
    ['Assign stations and tables at call time.', 'Brief servers on promos, champagne and big-bottle packages and VIP reservations.', 'Watch service speed, order slips and guest satisfaction.', 'Enter orders, sales comms, LD’s and PO per server in the Servers tracker.', 'Review each server daily with the 7 steps and set tomorrow’s action plan.'],
    ['Team orders and LD’s per night', 'Server attendance and punctuality', 'Guest complaints'], ['2+ years as server or captain', 'Coaching'], [3, 5, 11, 21]),
    j('Server',
    'Serves guests at assigned tables, takes orders on order slips (OS) and sells drinks, LD’s and packages.',
    ['Set up the station by duty time (10 PM).', 'Take orders on numbered order slips and serve promptly.', 'Sell ladies drinks, champagne and big-bottle packages and promo packages.', 'Settle bills with the cashier following guest-check procedures.', 'Keep tables clean and report guest issues to the Floor Supervisor.'],
    ['Orders per night', 'LD’s and sales comms. (Servers tracker)', 'Attendance and punctuality', 'Guest complaints'],
    ['Friendly and presentable', 'Basic English', 'Cash and order-slip discipline'], [11, 18, 21, 25, 26])),
  dept('Checkers', 'ga', j('Head Checker',
    'Controls stock and order checking between bar, kitchen and floor.',
    ['Check every order slip against what leaves the bar and kitchen.', 'Run nightly inventory counts with the Head Bartender and Kitchen Head.', 'Report stock and OS variances to the General Admin.', 'Train checkers on procedures.'],
    ['Stock variance', 'OS mismatches found', 'Counts completed'], ['Inventory experience', 'Integrity'], [10, 11, 20]),
    j('Checker', 'Checks orders and stock so nothing leaves without a valid order slip.',
    ['Match order slips to drinks and food released.', 'Record breakage and returns.', 'Help with nightly stock counts.', 'Report missing or duplicate order slips.'],
    ['OS checked', 'Variance found'], ['Attention to detail', 'Honesty'], [10, 11])),
  dept('Maintenance', 'shift', j('Maintenance Lead',
    'Keeps the building, power, plumbing and equipment working and safe.',
    ['Plan preventive maintenance for aircon, power, plumbing and furniture.', 'Fix defects reported by staff quickly.', 'Coordinate contractors and buy parts.', 'Keep a maintenance log.'],
    ['Open defects', 'Downtime', 'Maintenance cost'], ['Electrical and plumbing skills', 'Safety'], [16, 23, 27]),
    j('Maintenance Technician', 'Repairs and maintains facilities and equipment.',
    ['Do daily checks of lights, toilets, aircon and power.', 'Repair reported defects.', 'Follow safety rules for tools and equipment.'],
    ['Repairs completed', 'Response time'], ['Technical skills', 'Safety awareness'], [16, 23, 27])),
  dept('VIP Host', 'mem', j('VIP Relations Head',
    'Leads VIP hosting: reservations, consumables and VIP guest experience.',
    ['Assign VIP hosts to VIP, King and Ultra VIP areas.', 'Confirm VIP reservations and consumable minimums.', 'Grow repeat VIP guests and birthday bookings.', 'Coach hosts on bottle, champagne and big-bottle sales.'],
    ['VIP revenue vs. consumables', 'Repeat VIP guests', 'Bottle and champagne sales'], ['Hospitality and sales', 'Guest relations'], [20, 21, 26]),
    j('VIP Host', 'Takes care of VIP guests and drives table sales.',
    ['Welcome VIP guests and explain consumables.', 'Sell bottles, champagne and big-bottle promos.', 'Coordinate service with servers and bartenders.', 'Keep guests happy and safe all night.'],
    ['VIP table spend', 'Champagne and big-bottle sales'], ['Presentable and confident', 'Sales skills'], [13, 21, 26])),
  dept('Champagne Girls', 'mem', j('Champagne Team Lead',
    'Leads the champagne show and champagne sales.',
    ['Schedule the champagne show team.', 'Train on presentation, safety with sparklers and selling.', 'Track champagne package sales and commissions.'],
    ['Champagne packages sold', 'Show quality'], ['Performance and sales', 'Leadership'], [13, 21, 26]),
    j('Champagne Girl', 'Presents champagne and bottle service with show, and sells champagne packages.',
    ['Prepare costume and props before duty.', 'Present champagne and big bottles with the show.', 'Sell champagne and big-bottle packages and ladies drinks.', 'Follow sparkler safety rules.'],
    ['Packages sold', 'Show punctuality'], ['Presentable', 'Confident with guests'], [13, 23, 26])),
  dept('Models', 'trainsup', j('Head Models',
    'Leads the models: scheduling, grooming, presentation and appearances at events.',
    ['Schedule models for events and promotions.', 'Check grooming, outfits and presentation before doors open.', 'Coach models on guest engagement and conduct.', 'Review each model daily with the 7 steps.'],
    ['Models on time and ready', 'Event feedback'], ['Modeling or events experience', 'Leadership'], [8, 13, 25]),
    j('Model', 'Represents the club at events and on the floor, and appears in promotions.',
    ['Arrive at call time groomed and in the outfit assigned.', 'Appear at events, photo shoots and promotions.', 'Engage guests professionally.'],
    ['Appearances on time', 'Guest engagement'], ['Presentable', 'Confident on camera and with guests'], [8, 13, 25])),
  dept('MDC Babes', 'mem', j('Dance Captain',
    'Leads the MDC Babes: choreography, rehearsals, costumes and stage standards.',
    ['Create and rehearse choreography for events.', 'Schedule dancers per night.', 'Check costumes, grooming and stage safety.', 'Evaluate dancers weekly.'],
    ['Show quality', 'Dancer attendance', 'Event feedback'], ['Professional dance', 'Leadership'], [8, 13, 25]),
    j('Dancer (MDC Babe)', 'Performs on stage and engages guests to create the party atmosphere.',
    ['Attend rehearsals and call time.', 'Perform sets on schedule.', 'Engage guests professionally; sell ladies drinks and syringe shots where allowed.', 'Keep costumes and grooming to standard.'],
    ['Sets performed on time', 'Guest engagement'], ['Dance skills', 'Stage presence'], [8, 13, 25])),
  dept('Tech', 'mem', j('Technical Director',
    'Owns the sound and light systems and the technical team.',
    ['Maintain the sound, light and LED systems for both rooms.', 'Prepare tech riders for guest DJs.', 'Supervise technicians during events.', 'Plan upgrades and repairs.'],
    ['Technical downtime', 'Event readiness'], ['Pro audio and lighting', 'Leadership'], [16, 23, 27]),
    j('Sound & Light Technician', 'Runs sound and lights during the night.',
    ['Sound check before doors open.', 'Run lights and effects during sets.', 'Fix technical issues quickly.', 'Report equipment defects.'],
    ['Issues during sets', 'Readiness by call time'], ['Audio/lighting knowledge'], [16, 23, 27])),
  dept('DJ', 'mem', j('Music Director (Head DJ)',
    'Leads the DJ line-up and the musical direction of both rooms.',
    ['Plan DJ line-ups and set times for both rooms.', 'Host and brief international guest DJs and DJanes.', 'Keep the music policy for each room.', 'Coach resident DJs.'],
    ['Dance-floor energy and guest feedback', 'Set times kept'], ['Professional DJ experience', 'Music programming'], [3, 5, 16]),
    j('Resident DJ', 'Plays scheduled sets that keep the dance floor full.',
    ['Arrive before the set and check equipment.', 'Play to the room’s music policy.', 'Coordinate with the MC and lights.', 'Hand over smoothly to the next DJ.'],
    ['Sets on time', 'Crowd response'], ['DJ skills', 'Reading the crowd'], [3, 5, 16])),
  dept('MC', 'mem', j('Head MC',
    'Leads the MCs and the night’s announcements, promos and hype.',
    ['Write the night’s MC script with promos and birthdays.', 'Schedule MCs.', 'Coordinate with DJs, dancers and the champagne show.'],
    ['Promos announced', 'Event flow'], ['Hosting experience', 'Bilingual'], [7, 21]),
    j('MC / Host', 'Hosts the night: hype, announcements, promos and birthdays.',
    ['Announce promos, specials and birthdays.', 'Hype the crowd with the DJ.', 'Keep language respectful at all times.'],
    ['Announcements made', 'Crowd energy'], ['Confident voice', 'English and Filipino'], [7, 21])),
];

// Supervisors on Duty lead the heads of department.
DEPARTMENT_JOBS.find((d) => d.department === 'Supervisors')!.staff.level = 'head';

/** Every job in display order: management first, then each department’s head and staff. */
export function allJobs(): JobRole[] {
  const out: JobRole[] = [...MANAGEMENT];
  for (const d of DEPARTMENT_JOBS) {
    if (d.head) out.push(d.head);
    out.push(d.staff);
  }
  return out;
}

export interface DeptInfo { name: string; group?: string; dailyRate?: number; shiftStart?: string; shiftEnd?: string; paySheet?: string | null; nightDiffHours?: number | null }

/** A complete job description document: role text + what the handbook and settings say about the job. */
export function composeJob(role: JobRole, ctx: { roles: JobRole[]; departments: DeptInfo[]; headcount: Record<string, number>; company: string }) {
  const byKey = new Map(ctx.roles.map((x) => [x.key, x]));
  const dep = role.department ? ctx.departments.find((d) => d.name === role.department) : undefined;
  const supervises = ctx.roles.filter((x) => x.reportsTo === role.key).map((x) => ({ key: x.key, title: x.title, department: x.department, people: x.key.startsWith('staff:') && x.department ? ctx.headcount[x.department] ?? 0 : null }));
  const fmt = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const night = !dep || !dep.shiftStart || Number(dep.shiftStart.slice(0, 2)) >= 17;
  const schedule = role.level === 'management'
    ? ['As required by the business; on call during operating hours.', `Club call time ${fmt(HANDBOOK_RULES.callTime)}, duty ${fmt(HANDBOOK_RULES.dutyStart)} – ${fmt(HANDBOOK_RULES.dutyEnd)}.`]
    : night
      ? [`Call time ${fmt(HANDBOOK_RULES.callTime)} — clock in on the fingerprint scanner and the log book.`, `Break ${fmt(HANDBOOK_RULES.breakStart)} – ${fmt(HANDBOOK_RULES.breakEnd)}.`, `Duty ${fmt(HANDBOOK_RULES.dutyStart)} – ${fmt(HANDBOOK_RULES.dutyEnd)}.`, 'Schedule posted weekly; usual week of 5 working days and 2 days off. Swaps only with a replacement and manager approval.']
      : [`Shift ${fmt(dep!.shiftStart!)} – ${fmt(dep!.shiftEnd!)}, clocked in on the fingerprint scanner and the log book.`, 'Schedule posted weekly; swaps only with a replacement and manager approval.'];
  const pay = [
    dep?.dailyRate ? `Daily rate per employment contract (department planning rate on Schedules: ₱${dep.dailyRate.toLocaleString('en-PH')}).` : 'Salary per employment contract.',
    'Paid every week; sign the pay slip to confirm accuracy and receipt.',
    `Overtime after ${HANDBOOK_RULES.overtimeAfterHours} hours a day at 125%, approved by the department head and validated by the Operations Manager.`,
    ...(dep?.nightDiffHours ? [`Night differential 10% for ${dep.nightDiffHours} hours per working night.`] : []),
    `Late deductions: over 10 minutes late = 1 hour of pay; 1 hour or more late = half-day. A.W.O.L.: ₱${HANDBOOK_RULES.awolDeduction} per absence.`,
  ];
  const commissions = COMMISSIONS.filter((c) => c.who.includes('all') || (role.department && c.who.includes(role.department)) || (role.key === 'staff:Supervisors' && c.who.includes('Servers')))
    .map((c) => `${c.item}: ${c.amount}`);
  return {
    key: role.key, company: ctx.company, title: role.title, department: role.department, level: role.level, group: dep?.group ?? null,
    reportsTo: role.reportsTo ? { key: role.reportsTo, title: byKey.get(role.reportsTo)?.title ?? role.reportsTo } : null,
    supervises, headcount: role.key.startsWith('staff:') && role.department ? ctx.headcount[role.department] ?? 0 : null,
    summary: role.summary, duties: role.duties, kpis: role.kpis, skills: role.skills,
    schedule, pay, commissions,
    requirements: [`At least ${HANDBOOK_RULES.minimumAge} years old.`, `Original documents within ${HANDBOOK_RULES.documentsWithinDays} days of hire: ${HANDBOOK_REQUIREMENTS.join(', ')}.`, ...role.skills],
    evaluation: 'Written and verbal performance evaluation every week (5-star review on the Employee card). Pay increases and promotions are based on performance and results.',
    conduct: role.focusRules.map((n) => ({ n, text: GROUNDS[n - 1] })),
    discipline: DISCIPLINARY_COURSE,
  };
}
export type JobDoc = ReturnType<typeof composeJob>;

export interface ChartPlace { reportsTo: string | null; tier: ChartTier; holder?: string; title?: string; no?: number; also?: string[]; hidden?: boolean; offChart?: boolean }

/**
 * The company's organizational chart (Nov 2026): who reports to whom, who holds each role,
 * and the numbered heads of department 1–14. Roles marked `offChart` are not on the chart
 * and were placed where they fit best; `hidden` roles are merged into another box.
 */
export const ORG_CHART: Record<string, ChartPlace> = {
  ceo: { reportsTo: null, tier: 'executive', holder: 'Simon Donovan' },
  coo: { reportsTo: 'ceo', tier: 'executive', holder: 'Tsvetan “Ted” Lukarski' },
  elite: { reportsTo: 'coo', tier: 'manager', holder: 'Peter' },
  snl: { reportsTo: 'coo', tier: 'manager', holder: 'Elia' },
  purch: { reportsTo: 'coo', tier: 'supervisor', holder: 'Annie' },
  trainsup: { reportsTo: 'coo', tier: 'supervisor', holder: 'Maria' },
  ga: { reportsTo: 'coo', tier: 'supervisor', holder: 'Rhia' },
  'staff:Supervisors': { reportsTo: 'shift', tier: 'supervisor', holder: 'Khey, Jaysa, Charle' },
  shift: { reportsTo: 'coo', tier: 'manager', holder: 'Ina' },
  mem: { reportsTo: 'coo', tier: 'manager', holder: 'Julien Castillo' },
  pg: { reportsTo: 'coo', tier: 'manager', holder: 'Tihomir' },
  eliteac: { reportsTo: 'elite', tier: 'team' },
  driver: { reportsTo: 'ga', tier: 'staff', holder: 'John' },
  mkt: { reportsTo: 'mem', tier: 'team', holder: 'Dims, designers' },
  mdcpg: { reportsTo: 'pg', tier: 'team' },
  elitepg: { reportsTo: 'pg', tier: 'team' },
  'head:Maintenance': { reportsTo: 'purch', tier: 'head', no: 1, holder: 'Edwin', title: 'Head Maintenance', also: ['snl'] },
  'head:Checkers': { reportsTo: 'purch', tier: 'head', no: 2, holder: 'Lhaw', title: 'Head Inventory' },
  'head:Housekeeping': { reportsTo: 'purch', tier: 'head', no: 3, holder: 'Ricky', title: 'Head Housekeeping' },
  'head:Tech': { reportsTo: 'trainsup', tier: 'head', no: 4, holder: 'Israel', title: 'Head Tech', also: ['snl'] },
  'head:VIP Host': { reportsTo: 'trainsup', tier: 'head', no: 5, holder: 'Eka', title: 'Head VIP Hostesses & Champagne Girls' },
  'head:Champagne Girls': { reportsTo: 'trainsup', tier: 'head', hidden: true },
  'staff:Champagne Girls': { reportsTo: 'head:VIP Host', tier: 'staff' },
  'head:Models': { reportsTo: 'trainsup', tier: 'head', no: 6, holder: 'Kimmy' },
  'head:MDC Babes': { reportsTo: 'trainsup', tier: 'head', no: 7, holder: 'Shantal', title: 'Head Dancers (MDC Babes)' },
  'head:Servers': { reportsTo: 'staff:Supervisors', tier: 'head', no: 8, holder: 'Khey, Jaysa, Charle' },
  'head:Bartenders': { reportsTo: 'staff:Supervisors', tier: 'head', no: 9, holder: 'MJ / Ara' },
  'head:Shisha': { reportsTo: 'staff:Supervisors', tier: 'head', no: 10, holder: 'Kristal', title: 'Head Shisha' },
  'head:Kitchen': { reportsTo: 'staff:Supervisors', tier: 'head', no: 11, holder: 'Josh', title: 'Head Chef' },
  'head:Cashiers': { reportsTo: 'staff:Supervisors', tier: 'head', no: 12, holder: 'Jhep' },
  'head:Bouncers': { reportsTo: 'staff:Supervisors', tier: 'head', no: 13, holder: 'Jonel', title: 'Head Bouncers' },
  'head:Promoters': { reportsTo: 'staff:Supervisors', tier: 'head', no: 14, holder: 'Noah' },
  // Not on the chart: placed with the closest manager.
  'staff:Admin': { reportsTo: 'ga', tier: 'staff', offChart: true },
  'head:Receptionist': { reportsTo: 'ga', tier: 'head', offChart: true },
  'head:DJ': { reportsTo: 'mem', tier: 'head', offChart: true },
  'head:MC': { reportsTo: 'mem', tier: 'head', offChart: true },
};

/** Company edits to a role (or a whole new role when `custom`). */
export type RoleOverride = Partial<Omit<JobRole, 'key'>> & { holder?: string | null; custom?: boolean };
export type ResolvedRole = JobRole & { holder: string | null; edited: boolean; custom: boolean; onChart: boolean; tier: ChartTier; no: number | null; also: string[]; order: number };

export function resolveRoles(overrides: Record<string, RoleOverride>): ResolvedRole[] {
  const chartOrder = Object.keys(ORG_CHART);
  const base = allJobs().filter((role) => !ORG_CHART[role.key]?.hidden).map((role, i) => {
    const c = ORG_CHART[role.key];
    const o = overrides[role.key] ?? {};
    const { holder, custom: _c, ...fields } = o;
    const tier: ChartTier = c?.tier ?? (role.level === 'staff' ? 'staff' : role.level === 'head' ? 'head' : 'manager');
    return {
      ...role, title: c?.title ?? role.title, reportsTo: c ? c.reportsTo : role.reportsTo, ...fields, key: role.key,
      holder: holder !== undefined ? holder : c?.holder ?? null, edited: Object.keys(o).length > 0, custom: false,
      onChart: !!c && !c.offChart && !(role.level === 'staff' && role.key.startsWith('staff:') && !c.holder), tier, no: c?.no ?? null, also: c?.also ?? [],
      order: c ? chartOrder.indexOf(role.key) : 1000 + i,
    };
  });
  const custom = Object.entries(overrides).filter(([k, o]) => o.custom && !base.some((b) => b.key === k)).map(([key, o]) => ({
    key, title: o.title ?? 'New role', department: o.department ?? null, level: o.level ?? 'staff', reportsTo: o.reportsTo ?? null,
    summary: o.summary ?? '', duties: o.duties ?? [], kpis: o.kpis ?? [], skills: o.skills ?? [], focusRules: o.focusRules ?? [],
    holder: o.holder ?? null, edited: true, custom: true, onChart: true,
    tier: (o.level === 'management' ? 'manager' : o.level === 'head' ? 'head' : 'staff') as ChartTier, no: null, also: [], order: 2000,
  }));
  const all = [...base, ...custom];
  // A role cannot report to itself or to a missing role.
  for (const x of all) if (x.reportsTo === x.key || (x.reportsTo && !all.some((y) => y.key === x.reportsTo))) x.reportsTo = x.key === 'ceo' ? null : 'coo';
  for (const x of all) x.also = x.also.filter((k) => all.some((y) => y.key === k));
  return all;
}

/** Would setting `reportsTo` make a loop (A → B → A)? */
export function createsCycle(roles: { key: string; reportsTo: string | null }[], key: string, reportsTo: string | null) {
  const parent = new Map(roles.map((x) => [x.key, x.reportsTo]));
  let cur = reportsTo;
  for (let i = 0; cur && i < 100; i++) { if (cur === key) return true; cur = parent.get(cur) ?? null; }
  return false;
}
