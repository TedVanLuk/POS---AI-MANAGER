/**
 * Mega Dance Center Employee Handbook, transcribed from the client's 16-page PDF.
 * Wording is kept as written; only spelling was corrected. `HANDBOOK_RULES` holds the
 * numbers from the handbook that the system applies (call time, late deductions, AWOL…).
 */

export type Block =
  | { p: string }
  | { list: string[]; ordered?: boolean }
  | { table: { head: string[]; rows: string[][] } }
  | { note: string }
  | { floorPlan: true }
  | { orgChart: true }
  | { enforced: string[] };

export interface HandbookSection { id: string; part: string; title: string; blocks: Block[] }

export const HANDBOOK_RULES = {
  callTime: '20:30',
  breakStart: '21:00',
  breakEnd: '22:00',
  dutyStart: '22:00',
  dutyEnd: '06:00',
  /** Late deduction scheme: minutes late → hours of pay deducted. */
  lateTiers: [
    { minMinutes: 11, maxMinutes: 59, payHours: 1 },
    { minMinutes: 60, maxMinutes: null, payHours: 4 },
  ],
  awolDeduction: 500,
  excessiveTardinessPerMonth: 8,
  callInHoursBefore: 9,
  leaveRequestDaysBefore: 14,
  documentsWithinDays: 7,
  minimumAge: 18,
  overtimeAfterHours: 8,
  consecutiveNoShowResignation: 2,
};

export const HANDBOOK_REQUIREMENTS = ['NSO birth certificate', 'NBI clearance', 'Health ID', 'Barangay working ID'];
export const DISCIPLINARY_COURSE = ['Verbal warning', 'Written warning', 'Termination'];

/** Conduct that may result in disciplinary action up to immediate termination without a written warning. */
export const GROUNDS = [
  'Invalid work authorization forms.',
  'Supplying false or misleading information to the Business, including information at the time of application for employment or leave of absence.',
  'Not showing up for a shift without notifying the Manager on Duty. (No call, no show, no job.)',
  'Clocking another employee “in” or “out” on the Business timekeeping system, or having another employee clock you “in” or “out”.',
  'Leaving your job before the scheduled time without the permission of the Manager on Duty. (Job abandonment.)',
  'Arrest or conviction of a felony offense.',
  'Use of foul or abusive language.',
  'Disorderly or indecent conduct.',
  'Intoxication on Business property.',
  'Theft of customer, employee or Business property, including items found on Business premises — including but not limited to food, drinks or any kind of equipment.',
  'Theft, dishonesty or mishandling of Business funds. Failure to follow cash, guest check or credit card processing procedures.',
  'Refusal to follow instructions.',
  'Engaging in harassment of any kind toward another employee or customer.',
  'Failure to consistently perform job responsibilities in a satisfactory manner.',
  'Use, distribution or possession of illegal drugs on Business property, or being under the influence of these substances when reporting to work or during work hours.',
  'Waste or destruction of Business property.',
  'Actions or threats of violence or abusive language directed toward a customer or another team member.',
  'Excessive tardiness.',
  'Habitual failure to time in or out.',
  'Disclosing confidential information, including policies, procedures, menu or any proprietary information, to anyone outside the Business.',
  'Rude or improper behavior with customers, including the discussion of tips.',
  'Smoking or eating in unapproved areas or during unauthorized breaks.',
  'Failure to report safety hazards, equipment defects, accidents or injuries immediately to management.',
  'Not entering and exiting the business through the approved entrance.',
  'Failure to comply with the Business’s personal cleanliness and grooming standards.',
  'Failure to comply with the Business’s uniform and dress requirements.',
  'Unauthorized operation, repair or attempt to repair machines, tools or equipment.',
];

/** Commissions and privileges (Benefits and privileges page). */
export const COMMISSIONS: { item: string; amount: string; who: string[] }[] = [
  { item: 'Table commission — every new guest with an advance table reservation', amount: '5–10% of the bill', who: ['all'] },
  { item: 'Guestlist — every 10 persons invited before 11 PM', amount: '₱350 + 1 free bottle of Bacardi Gold with mixers and peanuts', who: ['Promoters', 'all'] },
  { item: 'Guestlist — each additional female guest above 10, before 11 PM', amount: '₱50', who: ['Promoters', 'all'] },
  { item: 'Ladies drinks — hard drinks', amount: '₱125', who: ['Servers', 'Champagne Girls', 'MDC Babes', 'VIP Host'] },
  { item: 'Ladies drinks — beer', amount: '₱100', who: ['Servers', 'Champagne Girls', 'MDC Babes', 'VIP Host'] },
  { item: 'Syringe shot sold', amount: '₱50', who: ['Servers', 'Champagne Girls', 'MDC Babes', 'Bartenders'] },
  { item: 'Promo package sold', amount: '₱50', who: ['Servers', 'VIP Host', 'Champagne Girls', 'Bartenders'] },
  { item: 'Champagne package — 2 bottles', amount: '₱300', who: ['Servers', 'Champagne Girls', 'VIP Host'] },
  { item: 'Champagne package — 4 bottles', amount: '₱600', who: ['Servers', 'Champagne Girls', 'VIP Host'] },
  { item: 'Big bottle promo — 1.5 L', amount: '₱300', who: ['Servers', 'VIP Host', 'Champagne Girls'] },
  { item: 'Big bottle promo — 3 L', amount: '₱600', who: ['Servers', 'VIP Host', 'Champagne Girls'] },
  { item: 'Ace of Spades — 2 bottles', amount: '₱900', who: ['Servers', 'VIP Host', 'Champagne Girls'] },
  { item: 'Monthly bonus — Magnum promo package (big bottle)', amount: '₱1,000', who: ['Servers', 'VIP Host', 'Champagne Girls'] },
  { item: 'Big sales of the night', amount: '₱500 – ₱1,000', who: ['all'] },
  { item: 'Birthday', amount: 'Free birthday party: VIP table, balloon decoration and bottle', who: ['all'] },
];

export const TABLES: { area: string; consumable: string }[] = [
  { area: 'Cocktail table', consumable: 'Non-consumable' },
  { area: 'Long table', consumable: '₱3,000' },
  { area: 'Regular VIP', consumable: '₱5,000' },
  { area: 'Mega VIP', consumable: '₱10,000' },
  { area: 'King VIP', consumable: '₱15,000' },
  { area: 'Grey King 1 — full', consumable: '₱35,000' },
  { area: 'Grey King 1 — single section', consumable: '₱12,000' },
  { area: 'Grey King 2 — full', consumable: '₱20,000' },
  { area: 'Grey King 2 — main section', consumable: '₱12,000' },
  { area: 'Grey King 2 — second section', consumable: '₱8,000' },
  { area: 'Single Ultra VIP', consumable: '₱15,000' },
  { area: 'Ultra VIP', consumable: '₱50,000' },
];

export const CORE_VALUES = [
  { title: 'Outstanding service', text: 'We believe in providing outstanding service. Our goal is to provide the kind of unique and genuine sort of personal care and attention that our customers tell stories about.' },
  { title: 'Raise the bar', text: 'We believe that “good” isn’t enough. We never stop trying to do it better, no matter how good we are. We constantly strive to “raise the bar.”' },
  { title: 'Honesty, respect and trust', text: 'We work to build trust with others in each and every transaction and interaction. We recognize that honesty, respect and trust form the bond that holds organizations and relationships together.' },
  { title: 'Training and development', text: 'We believe in the ongoing training and development of our people. We see it as a worthy investment in the future of the business and as a way of enabling our people to achieve their potential in whatever they do.' },
  { title: 'Love & teamwork', text: 'We believe our continued success depends on love & teamwork. We know that great achievements are only possible from helping and respecting each other.' },
  { title: 'Professional and orderly', text: 'We believe in doing business in a professional and orderly manner. We take great pride in having good systems, standardized procedures and being organized.' },
];

export const MDC_HANDBOOK: { title: string; company: string; sections: HandbookSection[] } = {
  title: 'Employee Handbook',
  company: 'Mega Dance Center',
  sections: [
    { id: 'welcome', part: 'Welcome', title: 'Welcome to our team!', blocks: [
      { p: 'Mega Dance Center looks forward to the opportunity to work with you and wants you to know that we recognize our employees as our most valuable resource. Our continued success in providing world-class entertainment, the highest quality of food, beverages and service to our customers depends on having quality people. We want you to enjoy your time here. We are committed to helping you succeed in your new career.' },
      { p: 'We have prepared this handbook to answer some of the questions that you may have concerning our policies. This handbook is intended solely as a guide. Read it thoroughly. If you have questions about anything, contact your Manager on Duty for assistance.' },
      { p: 'We hope you find your time with us to be a fun, enjoyable and rewarding experience.' },
    ] },
    { id: 'history', part: 'About Mega Dance Center', title: 'History', blocks: [
      { p: 'Mega Dance Center originated from Sofia, Bulgaria — a modern, European-style underground nightclub where the sound is purest. It is designed to express uniqueness, just like our guests. We created the first nightclub with onyx stone bars and walls, accompanied by the newest generation of sound and light system, wooden walls, LED lights and silver dragon granite.' },
      { list: [
        'The first underground nightclub in Angeles City.',
        'The first nightclub built with onyx stone.',
        'The first nightclub that brings top international DJs and DJanes to Angeles City.',
        'The first nightclub with two different rooms playing two different types of music at the same time.',
      ], ordered: true },
      { p: 'You have a choice as a guest of what you want to be and where you want to be: in the underground, a smaller but more elite circle, or in the main area where the party is rocking.' },
      { table: { head: ['Slogan', 'Years'], rows: [['The Best Party Place', '2019–2022'], ['Here is the Party', '2023–present']] } },
    ] },
    { id: 'mission', part: 'About Mega Dance Center', title: 'Mission, vision & objectives', blocks: [
      { note: 'Mission — To create an international nightclub stage and unique entertainment that the Philippines will be proud of.' },
      { note: 'Vision — We believe Mega Dance Center Night Club will open more huge opportunities in Angeles City, as we give you a unique nightlife experience and develop our city as a world-class entertainment capital.' },
      { p: 'Objectives:' },
      { list: [
        'Increase profit.',
        'Create world-class entertainment that will lift this city to a higher level every Filipino can be proud of.',
        'Bring Mega Dance Center Angeles City onto the international stage.',
        'Change this city into something better, creating more jobs and business opportunities.',
        'Show the world why partying is more fun in the Philippines.',
        'Provide the finest and most hospitable service.',
        'Staff character development to become independent leaders.',
        'Provide a healthy and safe working environment.',
      ], ordered: true },
    ] },
    { id: 'philosophy', part: 'About Mega Dance Center', title: 'Philosophy & core values', blocks: [
      { p: 'Success depends on our people. Our business can only prosper and provide opportunities for employment and growth when we continually improve ourselves and the work we do. We recognize, however, that success is not measured by sales, guest counts and numbers alone. We are measured as much by the way in which we achieve our goals as we are by the actual achievements. We believe that a commitment to uncompromising values and integrity should always guide our decisions and actions as we pursue our goals.' },
      { p: 'The following core values form the foundation of our measurement of success:' },
      { list: CORE_VALUES.map((v) => `${v.title} — ${v.text}`) },
    ] },
    { id: 'facilities', part: 'About Mega Dance Center', title: 'Facilities & floor plan', blocks: [
      { table: { head: ['Facility', 'Count'], rows: [['Entrance', '2'], ['Lobby', '1'], ['Bar', '3'], ['Room', '2'], ['Dressing room', '1'], ['VIP room', '1'], ['Toilet', '4'], ['Cocktail table', '24'], ['Long table', '9'], ['Red couch', '8'], ['Mega VIP', '10'], ['Ultra VIP', '1'], ['Grey King 1', '1'], ['Grey King 2', '1']] } },
      { floorPlan: true },
      { table: { head: ['Table / area', 'Consumable'], rows: TABLES.map((t) => [t.area, t.consumable]) } },
    ] },
    { id: 'org', part: 'About Mega Dance Center', title: 'Organizational chart', blocks: [
      { orgChart: true },
    ] },
    { id: 'hiring', part: 'Policy', title: 'Hiring, requirements & age', blocks: [
      { p: 'We hire only Filipino citizens and aliens who are authorized to work in this country. As required by law, employees will be required to provide original documents within 1 week of their date of hire. If the documents are not provided within that period, we have no choice, under the law, but to terminate the employee until the appropriate documents are provided. The details provided must be valid and authentic. If at any time during an employee’s employment it is discovered that any document used was invalid or not authentic, the employee must, by law, be immediately terminated.' },
      { p: 'List of requirements:' },
      { list: HANDBOOK_REQUIREMENTS },
      { p: 'Age requirement: as per the law, all employees must be at least 18 years of age.' },
      { enforced: ['Each employee’s working ID is uploaded and verified on the Employees List (Working ID column).'] },
    ] },
    { id: 'training', part: 'Policy', title: 'Training & evaluation', blocks: [
      { p: 'To help you be successful in your job you will receive adequate training. You will not be expected to be on your own until you are ready. You will participate in detailed training programs and receive training materials to help you perform your job the right way. Your trainers are considered our “best” and have been certified to train for that position. We spend considerable time and money educating our trainers to prepare each new employee for their job. We want you to be a knowledgeable and productive member of our team.' },
      { p: 'All employees receive written and verbal performance evaluations every week. The evaluation process is intended to let you know how well you’re performing and help you be more effective and productive. The evaluation also gives you the opportunity to share your thoughts about your performance and future goals with your manager.' },
      { p: 'The evaluation process is an opportunity to identify accomplishments and strengths, as well as to openly discuss areas and goals for improvement. Depending on your position and performance, you may be eligible for a pay increase and/or promotion. Pay increases are not guaranteed. Rewards are based solely on a person’s job performance and results.' },
      { enforced: ['Evaluations are recorded as 5-star reviews on each Employee card.'] },
    ] },
    { id: 'schedules', part: 'Policy · General policies', title: 'Hours of work & schedules', blocks: [
      { p: 'Schedules are prepared to meet the work demands of the business. As work demands change, management reserves the right to adjust working hours and shifts. Schedules are posted weekly. Each employee is responsible for working their shifts.' },
      { table: { head: ['', 'Time'], rows: [['Call time', '8:30 PM'], ['Break time', '9:00 PM – 10:00 PM'], ['Duty', '10:00 PM – 6:00 AM']] } },
      { list: [
        'Clock in using the biometrics system and the log book when your shift begins, and be ready to start work immediately.',
        'Employees must enter and exit through the front door during business hours — not the back door.',
        'Schedule changes may be allowed only if you find a replacement and get a manager’s approval. The business usually requires high levels of staff on or around holidays and other special events. We understand that you have a life outside of the business; this industry will require you to work when everyone else is not. We work when other people celebrate. Each position is important to the proper functioning of the business.',
      ], ordered: true },
      { enforced: ['Lateness is counted from the 8:30 PM call time on the fingerprint clock.', 'The weekly schedule is on the Schedules page.'] },
    ] },
    { id: 'overtime', part: 'Policy · General policies', title: 'Overtime & coverage', blocks: [
      { p: 'Employees are paid overtime when they work more than 8 hours a day. Approval must be obtained from the respective department head and validated by the Operations Manager only.' },
      { p: 'Coverage: the company rules and regulations shall be applied and enforced on all employees of Mega Dance Center in order to achieve efficiency, productivity, and a healthy and safe working environment.' },
      { enforced: ['Overtime is paid at 125% of the hourly rate on the weekly payroll, in whole hours.'] },
    ] },
    { id: 'absences', part: 'Policy · General policies', title: 'Absences & leave', blocks: [
      { p: 'All employees are expected to work on a regular, consistent basis and complete their regularly scheduled hours per week. Excessive absenteeism may result in disciplinary action, up to and including termination.' },
      { list: [
        'If you are going to be late or miss work, you are expected to call and talk to the Manager on Duty at least 9 hours before you are scheduled to work.',
        'Any employee who does not call or report to work for two consecutive shifts will be considered to have voluntarily resigned.',
        'Before taking a leave of absence for vacation, personal leave or another planned absence, an Employee Leave Request Form should be submitted to and approved by the Manager on Duty.',
        'Employee Leave Requests should be submitted at least two weeks before the scheduled leave date, unless the request is due to an unexpected emergency. The nature of the emergency should then be shared with the Manager on Duty.',
        'To return to work from an accident or medical leave, the employee must present a doctor’s medical certificate stating that they are fit to work.',
        'Any employee who fails to return to work at the end of a personal leave of absence will be deemed to have abandoned their job, unless they give a reason satisfactory to management.',
      ], ordered: true },
      { p: 'Emergency leave — notification for absences: absences with notification must be approved by management. Absence without notification is A.W.O.L. (Absence Without Official Leave). This is a serious offense that calls for disciplinary action against the offender. Salary deduction: ₱500 for each absence.' },
      { enforced: ['Unexcused absences create a ₱500 A.W.O.L. deduction on the Penalties tab for approval.'] },
    ] },
    { id: 'tardiness', part: 'Policy · General policies', title: 'Tardiness & undertime', blocks: [
      { p: 'Employees must report to their assigned work areas promptly. Everyone is expected to be in their proper place on or before the start of working hours. All are required to time in and out using the log book, the fingerprint biometric system or a time card, monitored by admin or supervisors.' },
      { table: { head: ['Late', 'Deduction'], rows: [['Over 10 minutes but less than 30 minutes', '1 hour of pay'], ['1 hour up to a maximum of 4 hours', 'Half-day of pay (4 hours)']] } },
      { note: 'More than eight (8) times late within a month is considered excessive tardiness, subjecting the employee to appropriate punishment and/or disciplinary action.' },
      { p: 'Undertime taken at any time of a workday, and undertime due to tardiness, is deductible from salary. Undertime without approval may be considered abandonment of duty or A.W.O.L.' },
      { enforced: ['The late deduction scheme runs from the fingerprint clock and appears on Payroll → Penalties for approval, then on the weekly payroll as a deduction.'] },
    ] },
    { id: 'compensation', part: 'Policy · General policies', title: 'Compensation', blocks: [
      { p: 'Salaries are paid every week. Employees are required to sign their pay slips as evidence of accuracy and receipt of salary.' },
      { enforced: ['Weekly payroll sheets with a Paid column per person are on Payroll → Weekly payroll.'] },
    ] },
    { id: 'benefits', part: 'Policy · General policies', title: 'Benefits & privileges', blocks: [
      { table: { head: ['Commission / privilege', 'Amount'], rows: COMMISSIONS.map((c) => [c.item, c.amount]) } },
    ] },
    { id: 'termination', part: 'Policy · General policies', title: 'Termination of service', blocks: [
      { p: 'The company has the right to terminate employees based on valid grounds under the Labor Code, or when authorized by existing laws, or for failure to qualify as a regular employee in accordance with the company’s standards.' },
    ] },
    { id: 'discipline', part: 'Policy', title: 'Disciplinary actions', blocks: [
      { note: 'An employee involved in any of the following conduct may be subject to disciplinary action up to and including immediate termination without a written warning.' },
      { list: GROUNDS, ordered: true },
      { p: 'Courses of disciplinary action:' },
      { list: DISCIPLINARY_COURSE, ordered: true },
      { enforced: ['Warnings are recorded as management notes on the employee (category “Warning”).'] },
    ] },
  ],
};
