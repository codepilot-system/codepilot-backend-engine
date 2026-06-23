export const CONCERN_PATTERNS: Record<string, RegExp[]> = {
    DB_ACCESS: [
        /prisma\./i, /db\./i, /\.query\(/i, /\.execute\(/i,
        /repository\./i, /entityManager\./i,
        /DriverManager/i, /PreparedStatement/i, /ResultSet/i,
        /SQLException/i, /createConnection/i, /connect\(/i, /cursor\(/i
    ],
    HTTP_CALLS: [
        /\bfetch\(/i, /axios\./i,
        /HttpClient/i, /HttpRequest/i, /HttpResponse/i,
        /URLConnection/i, /OkHttpClient/i,
        /\.request\(/i, /requests\./i
    ],
    FILE_SYSTEM: [
        /\bfs\./i, /readFile\b/i, /writeFile\b/i,
        /FileWriter/i, /FileReader/i, /BufferedReader/i,
        /Files\./i, /FileInputStream/i, /FileOutputStream/i,
        /\bopen\(/i
    ],
    LOGGING: [
        /console\.log\(/i, /console\.error\(/i, /console\.warn\(/i,
        /logger\./i, /winston\./i, /bunyan\./i,
        /Logger\./i, /log\.info/i, /log\.error/i
    ],
    EMAIL_NOTIFY: [
        /sendEmail\(/i, /mailer\./i, /sendNotification\(/i,
        /nodemailer/i, /smtp/i, /MimeMessage/i
    ],
    AUTH: [
        /jwt\./i, /bcrypt\./i, /\.verify\(/i,
        /Jwts\./i, /BCrypt/i, /SecretKey/i,
        /MessageDigest/i, /\.sign\(/i, /\.encode\(/i, /\.hash\(/i
    ],
    VALIDATION: [
        /\bvalidate\(/i, /schema\./i, /isValid\(/i,
        /joi\./i, /yup\./i, /zod\./i
    ],
    RENDERING: [
        /res\.send\(/i, /res\.json\(/i, /res\.render\(/i,
        /template\./i, /handlebars\./i
    ]
};
