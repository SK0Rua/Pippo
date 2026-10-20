// План паків слів для магазину. Зміст генерує scripts/generate-packs.js у packs/<id>.json,
// іконки лежать у public/packs/<id>.svg.
// type: topic | profession | situation | language | level | course | screen
// Паки серіалів і фільмів (screen) генерує scripts/build-screen-pack.js у scripts/screen-plan.json.

module.exports = [
  // ---------- Теми життя ----------
  { id: 'airport', type: 'topic', level: 'A2', size: 50, title: 'Аеропорт і переліт', description: 'Реєстрація, багаж, посадка й митниця — щоб не губитися в жодному аеропорту.', focus: 'airport, check-in, luggage, boarding, security, customs, flights' },
  { id: 'hotel', type: 'topic', level: 'A2', size: 20, title: 'Готель', description: 'Бронювання, заселення й прохання до рецепції.', focus: 'hotel booking, check-in/out, room types, hotel services, complaints' },
  { id: 'restaurant', type: 'topic', level: 'A2', size: 50, title: 'Ресторан і кафе', description: 'Замовити, попросити рахунок і розібратися в меню.', focus: 'ordering food, menu words, paying the bill, table service, cafe' },
  { id: 'cooking', type: 'topic', level: 'B1', size: 100, title: 'Їжа та кулінарія', description: 'Продукти, способи приготування й смаки — для рецептів і кулінарних шоу.', focus: 'ingredients, cooking verbs, kitchen tools, tastes and textures, recipes' },
  { id: 'home', type: 'topic', level: 'A2', size: 50, title: 'Дім і побут', description: 'Кімнати, меблі, прибирання та дрібний ремонт.', focus: 'rooms, furniture, appliances, household chores, simple repairs' },
  { id: 'health', type: 'topic', level: 'B1', size: 50, title: 'Здоров’я та самопочуття', description: 'Симптоми, ліки, звички й здоровий спосіб життя.', focus: 'symptoms, illnesses, medicine, body, healthy habits, wellbeing' },
  { id: 'shopping', type: 'topic', level: 'A2', size: 20, title: 'Покупки', description: 'Розміри, знижки, обмін і повернення товару.', focus: 'shopping, sizes, prices, discounts, returns and exchanges' },
  { id: 'emotions', type: 'topic', level: 'B1', size: 100, title: 'Емоції та характер', description: 'Як описати почуття, настрій і риси людей точніше, ніж «good» і «bad».', focus: 'feelings, moods, personality traits, describing people and reactions' },
  { id: 'nature', type: 'topic', level: 'A2', size: 50, title: 'Природа і погода', description: 'Погода, пори року, ландшафти й тварини.', focus: 'weather, seasons, landscapes, plants, animals, environment' },
  { id: 'sport', type: 'topic', level: 'B1', size: 50, title: 'Спорт і фітнес', description: 'Тренування, змагання й спортзал.', focus: 'sports, gym, workouts, competitions, fitness equipment' },
  { id: 'family', type: 'topic', level: 'B1', size: 50, title: 'Сім’я та стосунки', description: 'Родичі, дружба, побачення і все, що між людьми.', focus: 'family members, relationships, dating, friendship, conflicts' },
  { id: 'gadgets', type: 'topic', level: 'B1', size: 50, title: 'Технології та гаджети', description: 'Смартфони, застосунки, інтернет і все цифрове.', focus: 'devices, apps, internet, social media, everyday technology' },
  { id: 'city', type: 'topic', level: 'A2', size: 20, title: 'Місто і транспорт', description: 'Як дістатися, куди повернути й де пересісти.', focus: 'city places, public transport, directions, tickets' },
  { id: 'money', type: 'topic', level: 'B1', size: 20, title: 'Гроші та банк', description: 'Рахунки, картки, перекази й особисті фінанси.', focus: 'bank accounts, cards, transfers, loans, saving and spending' },
  { id: 'education', type: 'topic', level: 'B1', size: 50, title: 'Навчання', description: 'Школа, університет, курси та іспити.', focus: 'school, university, courses, exams, studying' },

  // ---------- Професії ----------
  { id: 'it', type: 'profession', level: 'B2', size: 100, title: 'IT і розробка', description: 'Лексика розробників: код, релізи, баги, архітектура й робота в команді.', focus: 'software development, programming, deployment, bugs, agile teamwork, architecture' },
  { id: 'medicine', type: 'profession', level: 'B2', size: 100, title: 'Медицина', description: 'Для лікарів і медперсоналу: діагнози, процедури, обстеження.', focus: 'diagnosis, treatment, procedures, hospital departments, medical examinations' },
  { id: 'marketing', type: 'profession', level: 'B2', size: 50, title: 'Маркетинг', description: 'Бренд, кампанії, аудиторія та метрики.', focus: 'branding, campaigns, target audience, digital marketing, analytics' },
  { id: 'finance', type: 'profession', level: 'B2', size: 50, title: 'Фінанси', description: 'Бюджети, звітність, інвестиції та бухгалтерія.', focus: 'accounting, budgeting, financial statements, investments, taxes' },
  { id: 'law', type: 'profession', level: 'C1', size: 50, title: 'Юриспруденція', description: 'Договори, суд, права й обов’язки.', focus: 'contracts, court, lawsuits, legal rights and obligations, legal procedures' },
  { id: 'sales', type: 'profession', level: 'B1', size: 50, title: 'Продажі', description: 'Клієнти, угоди, заперечення й переговори.', focus: 'sales process, clients, deals, negotiation, objections, targets' },
  { id: 'hr', type: 'profession', level: 'B2', size: 20, title: 'HR і рекрутинг', description: 'Найм, онбординг і розвиток команди.', focus: 'recruiting, hiring, onboarding, employee benefits, performance review' },
  { id: 'logistics', type: 'profession', level: 'B1', size: 50, title: 'Логістика і склад', description: 'Вантажі, доставка, склад і відстеження.', focus: 'warehouse, shipping, freight, inventory, supply chain, delivery' },
  { id: 'construction', type: 'profession', level: 'B1', size: 50, title: 'Будівництво', description: 'Інструменти, матеріали та роботи на будмайданчику.', focus: 'construction site, building materials, tools, safety, trades' },
  { id: 'design', type: 'profession', level: 'B2', size: 20, title: 'Дизайн', description: 'Макети, типографіка, кольори й фідбек.', focus: 'graphic and UI design, layout, typography, colour, design feedback' },
  { id: 'hospitality', type: 'profession', level: 'B1', size: 50, title: 'Готельно-ресторанна справа', description: 'Робота з гостями: сервіс, кухня, рецепція.', focus: 'working in hotels and restaurants, guest service, reception, kitchen staff duties' },
  { id: 'caregiving', type: 'profession', level: 'B1', size: 50, title: 'Догляд за людьми', description: 'Для доглядальниць і медсестер: допомога, гігієна, ліки, режим дня.', focus: 'caring for elderly or sick people, personal care, mobility help, medication routine, nursing home' },
  { id: 'driving', type: 'profession', level: 'B1', size: 20, title: 'Водій і перевезення', description: 'Маршрути, авто, вантаж і дорожні ситуації.', focus: 'professional driving, trucks, routes, vehicle checks, traffic situations' },

  // ---------- Ситуації ----------
  { id: 'interview', type: 'situation', level: 'B1', size: 50, title: 'Співбесіда', description: 'Розповісти про себе, досвід і сильні сторони.', focus: 'job interview questions and answers, experience, strengths, salary expectations' },
  { id: 'relocation', type: 'situation', level: 'B1', size: 50, title: 'Переїзд за кордон', description: 'Оренда житла, банк, документи й державні установи.', focus: 'renting a flat, residence permit, documents, registering, opening a bank account, utilities' },
  { id: 'smalltalk', type: 'situation', level: 'A2', size: 20, title: 'Small talk', description: 'Легкі розмови ні про що — погода, вихідні, плани.', focus: 'casual conversation phrases, weekend, weather, plans, polite reactions' },
  { id: 'business-email', type: 'situation', level: 'B2', size: 50, title: 'Ділове листування', description: 'Ввічливо попросити, нагадати й домовитися в листі.', focus: 'formal emails, requests, follow-ups, attachments, polite business phrases' },
  { id: 'phone', type: 'situation', level: 'A2', size: 20, title: 'Телефонні розмови', description: 'Подзвонити, перепитати й залишити повідомлення.', focus: 'phone calls, voicemail, hold the line, call back, bad connection' },
  { id: 'doctor', type: 'situation', level: 'A2', size: 20, title: 'У лікаря', description: 'Записатися на прийом і пояснити, що болить.', focus: 'doctor appointment, describing pain and symptoms, prescriptions, pharmacy' },
  { id: 'meetings', type: 'situation', level: 'B2', size: 20, title: 'Робочі наради', description: 'Погодитись, заперечити й підсумувати на мітингу.', focus: 'meetings, agenda, agreeing and disagreeing, action items, summarising' },

  // ---------- Мовні явища ----------
  { id: 'phrasal-verbs', type: 'language', level: 'B1', size: 100, title: 'Фразові дієслова', description: 'Найуживаніші get up, give up, look after і ще 97 — без них живої англійської не буває.', focus: 'the most common English phrasal verbs (verb + particle), each as a whole unit' },
  { id: 'idioms', type: 'language', level: 'B2', size: 50, title: 'Ідіоми на кожен день', description: 'Break the ice, a piece of cake та інші вирази, яких не знайти дослівно.', focus: 'common everyday English idioms; translation is the Ukrainian meaning or equivalent idiom' },
  { id: 'slang', type: 'language', level: 'B2', size: 50, title: 'Сучасний сленг', description: 'Як говорять у мережі, серіалах і між друзями.', focus: 'modern informal English slang used by young people and online (not offensive)' },
  { id: 'false-friends', type: 'language', level: 'B1', size: 20, title: 'Хибні друзі перекладача', description: 'Magazine — не магазин, а sympathetic — не симпатичний.', focus: 'English words that look or sound like Ukrainian/Russian words but mean something different (false friends); translation is the real meaning' },
  { id: 'collocations', type: 'language', level: 'B1', size: 50, title: 'Колокації: make, do, take, have', description: 'Make a decision чи do a decision? Сталі поєднання слів.', focus: 'fixed collocations with make, do, take, have, give (e.g. make a decision, do homework); term is the whole collocation' },
  { id: 'linking-words', type: 'language', level: 'B2', size: 20, title: 'Слова-зв’язки', description: 'However, moreover, whereas — для есе, листів і презентацій.', focus: 'linking words and discourse markers for writing and speaking' },
  { id: 'irregular-verbs', type: 'language', level: 'A2', size: 100, title: 'Неправильні дієслова', description: '100 головних неправильних дієслів. У транскрипції — усі три форми.', focus: 'the 100 most common English irregular verbs; term is "to <base form>"; transcription field must contain the three forms in IPA like /ɡəʊ – went – ɡɒn/ written as "base – past – past participle" with IPA; example uses the past simple or past participle form' },

  // ---------- Рівні ----------
  { id: 'core-a1', type: 'level', level: 'A1', size: 100, title: 'Основа A1', description: '100 найперших слів, з яких починається англійська.', focus: 'the most essential beginner English vocabulary (CEFR A1): everyday nouns, verbs, adjectives' },
  { id: 'core-a2', type: 'level', level: 'A2', size: 100, title: 'Основа A2', description: 'Наступні 100 слів для впевнених простих розмов.', focus: 'core elementary English vocabulary (CEFR A2)' },
  { id: 'core-b1', type: 'level', level: 'B1', size: 100, title: 'Основа B1', description: 'Слова для вільного спілкування на побутові теми.', focus: 'core intermediate English vocabulary (CEFR B1)' },
  { id: 'core-b2', type: 'level', level: 'B2', size: 100, title: 'Основа B2', description: 'Лексика, щоб висловлювати думки точно й аргументовано.', focus: 'core upper-intermediate English vocabulary (CEFR B2)' },
  { id: 'core-c1', type: 'level', level: 'C1', size: 100, title: 'Основа C1', description: 'Просунута лексика для тих, хто хоче звучати як носій.', focus: 'advanced English vocabulary (CEFR C1)' },
  // ---------- Підручники ----------
  // Зміст зібрано зі словника підручника (scripts/build-wordlist-pack.js): приклади й транскрипція — з книжки.
  { id: 'ef4e-int-1', type: 'course', level: 'B1', size: 123, title: 'English File Int · File 1', description: 'Їжа й кулінарія, риси характеру та перші розмовні фрази.', focus: 'English File 4th edition Intermediate, File 1: food and cooking, personality adjectives, practical and social English' },
  { id: 'ef4e-int-2', type: 'course', level: 'B1', size: 51, title: 'English File Int · File 2', description: 'Гроші, складені іменники та «сильні» прикметники.', focus: 'English File 4th edition Intermediate, File 2: money, compound nouns, strong adjectives' },
  { id: 'ef4e-int-3', type: 'course', level: 'B1', size: 98, title: 'English File Int · File 3', description: 'Транспорт, прийменники після слів, дорожні ситуації.', focus: 'English File 4th edition Intermediate, File 3: transport, dependent prepositions, practical and social English' },
  { id: 'ef4e-int-4', type: 'course', level: 'B1', size: 46, title: 'English File Int · File 4', description: 'Телефонна розмова та прикметники на -ed / -ing.', focus: 'English File 4th edition Intermediate, File 4: phone language, -ed/-ing adjectives' },
  { id: 'ef4e-int-5', type: 'course', level: 'B1', size: 84, title: 'English File Int · File 5', description: 'Спорт і стосунки.', focus: 'English File 4th edition Intermediate, File 5: sport, relationships, practical and social English' },
  { id: 'ef4e-int-6', type: 'course', level: 'B1', size: 70, title: 'English File Int · File 6', description: 'Кіно та частини тіла.', focus: 'English File 4th edition Intermediate, File 6: cinema, the body' },
  { id: 'ef4e-int-7', type: 'course', level: 'B1', size: 94, title: 'English File Int · File 7', description: 'Освіта й житло.', focus: 'English File 4th edition Intermediate, File 7: education, houses, practical and social English' },
  { id: 'ef4e-int-8', type: 'course', level: 'B1', size: 106, title: 'English File Int · File 8', description: 'Робота, покупки й словотвір.', focus: 'English File 4th edition Intermediate, File 8: work, shopping, word building' },
  { id: 'ef4e-int-9', type: 'course', level: 'B1', size: 83, title: 'English File Int · File 9', description: 'Гаджети та словотвір.', focus: 'English File 4th edition Intermediate, File 9: electronic devices, word building, practical and social English' },
  { id: 'ef4e-int-10', type: 'course', level: 'B1', size: 15, title: 'English File Int · File 10', description: 'Злочини й складені іменники.', focus: 'English File 4th edition Intermediate, File 10: crime, compound nouns' },

  { id: 'ielts', type: 'level', level: 'C1', size: 100, title: 'IELTS: академічна лексика', description: 'Слова з Academic Word List для есе й читання на IELTS.', focus: 'IELTS academic vocabulary from the Academic Word List, useful for essays and reading' },

  ...require('./screen-plan.json'),
];
