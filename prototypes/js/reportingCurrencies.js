// Currency codes + labels for reporting settings
(function (global) {
    var RAW =
        'AED:United Arab Emirates dirham\n' +
        'AFN:Afghan afghani\n' +
        'ALL:Albanian lek\n' +
        'AMD:Armenian dram\n' +
        'ANG:Netherlands Antillean guilder\n' +
        'AOA:Angolan kwanza\n' +
        'ARS:Argentine peso\n' +
        'AUD:Australian dollar\n' +
        'AWG:Aruban florin\n' +
        'AZN:Azerbaijani manat\n' +
        'BAM:Bosnia and Herzegovina convertible mark\n' +
        'BBD:Barbados dollar\n' +
        'BDT:Bangladeshi taka\n' +
        'BGN:Bulgarian lev\n' +
        'BHD:Bahraini dinar\n' +
        'BIF:Burundian franc\n' +
        'BMD:Bermudian dollar\n' +
        'BND:Brunei dollar\n' +
        'BOB:Bolivian boliviano\n' +
        'BRL:Brazilian real\n' +
        'BSD:Bahamian dollar\n' +
        'BTN:Bhutanese ngultrum\n' +
        'BWP:Botswana pula\n' +
        'BYN:Belarusian ruble\n' +
        'BZD:Belize dollar\n' +
        'CAD:Canadian dollar\n' +
        'CDF:Congolese franc\n' +
        'CHF:Swiss franc\n' +
        'CLP:Chilean peso\n' +
        'CNY:Chinese yuan\n' +
        'COP:Colombian peso\n' +
        'CRC:Costa Rican colón\n' +
        'CUP:Cuban peso\n' +
        'CVE:Cape Verdean escudo\n' +
        'CZK:Czech koruna\n' +
        'DJF:Djiboutian franc\n' +
        'DKK:Danish krone\n' +
        'DOP:Dominican peso\n' +
        'DZD:Algerian dinar\n' +
        'EGP:Egyptian pound\n' +
        'ERN:Eritrean nakfa\n' +
        'ETB:Ethiopian birr\n' +
        'EUR:Euro\n' +
        'FJD:Fiji dollar\n' +
        'FKP:Falkland Islands pound\n' +
        'GBP:Pound sterling\n' +
        'GEL:Georgian lari\n' +
        'GHS:Ghanaian cedi\n' +
        'GIP:Gibraltar pound\n' +
        'GMD:Gambian dalasi\n' +
        'GNF:Guinean franc\n' +
        'GTQ:Guatemalan quetzal\n' +
        'GYD:Guyanese dollar\n' +
        'HKD:Hong Kong dollar\n' +
        'HNL:Honduran lempira\n' +
        'HTG:Haitian gourde\n' +
        'HUF:Hungarian forint\n' +
        'IDR:Indonesian rupiah\n' +
        'ILS:Israeli new shekel\n' +
        'IMP:Manx pound\n' +
        'INR:Indian rupee\n' +
        'IQD:Iraqi dinar\n' +
        'IRR:Iranian rial\n' +
        'ISK:Icelandic króna\n' +
        'JEP:Jersey pound\n' +
        'JMD:Jamaican dollar\n' +
        'JOD:Jordanian dinar\n' +
        'JPY:Japanese yen\n' +
        'KES:Kenyan shilling\n' +
        'KGS:Kyrgyzstani som\n' +
        'KHR:Cambodian riel\n' +
        'KMF:Comorian franc\n' +
        'KRW:South Korean won\n' +
        'KWD:Kuwaiti dinar\n' +
        'KYD:Cayman Islands dollar\n' +
        'KZT:Kazakhstani tenge\n' +
        'LAK:Lao kip\n' +
        'LBP:Lebanese pound\n' +
        'LKR:Sri Lankan rupee\n' +
        'LRD:Liberian dollar\n' +
        'LSL:Lesotho loti\n' +
        'LYD:Libyan dinar\n' +
        'MAD:Moroccan dirham\n' +
        'MDL:Moldovan leu\n' +
        'MGA:Malagasy ariary\n' +
        'MKD:Macedonian denar\n' +
        'MMK:Myanmar kyat\n' +
        'MNT:Mongolian tögrög\n' +
        'MOP:Macanese pataca\n' +
        'MRU:Mauritanian ouguiya\n' +
        'MUR:Mauritian rupee\n' +
        'MVR:Maldivian rufiyaa\n' +
        'MWK:Malawian kwacha\n' +
        'MXN:Mexican peso\n' +
        'MYR:Malaysian ringgit\n' +
        'MZN:Mozambican metical\n' +
        'NAD:Namibian dollar\n' +
        'NGN:Nigerian naira\n' +
        'NIO:Nicaraguan córdoba\n' +
        'NOK:Norwegian krone\n' +
        'NPR:Nepalese rupee\n' +
        'NZD:New Zealand dollar\n' +
        'OMR:Omani rial\n' +
        'PAB:Panamanian balboa\n' +
        'PEN:Peruvian sol\n' +
        'PGK:Papua New Guinean kina\n' +
        'PHP:Philippine peso\n' +
        'PKR:Pakistani rupee\n' +
        'PLN:Polish złoty\n' +
        'PYG:Paraguayan guaraní\n' +
        'QAR:Qatari riyal\n' +
        'RON:Romanian leu\n' +
        'RSD:Serbian dinar\n' +
        'RUB:Russian ruble\n' +
        'RWF:Rwandan franc\n' +
        'SAR:Saudi riyal\n' +
        'SBD:Solomon Islands dollar\n' +
        'SCR:Seychellois rupee\n' +
        'SDG:Sudanese pound\n' +
        'SEK:Swedish krona\n' +
        'SGD:Singapore dollar\n' +
        'SHP:Saint Helena pound\n' +
        'SLE:Sierra Leonean leone\n' +
        'SOS:Somali shilling\n' +
        'SRD:Surinamese dollar\n' +
        'SSP:South Sudanese pound\n' +
        'STN:São Tomé and Príncipe dobra\n' +
        'SVC:Salvadoran colón\n' +
        'SYP:Syrian pound\n' +
        'SZL:Swazi lilangeni\n' +
        'THB:Thai baht\n' +
        'TJS:Tajikistani somoni\n' +
        'TMT:Turkmenistan manat\n' +
        'TND:Tunisian dinar\n' +
        'TOP:Tongan paʻanga\n' +
        'TRY:Turkish lira\n' +
        'TTD:Trinidad and Tobago dollar\n' +
        'TWD:New Taiwan dollar\n' +
        'TZS:Tanzanian shilling\n' +
        'UAH:Ukrainian hryvnia\n' +
        'UGX:Ugandan shilling\n' +
        'USD:United States dollar\n' +
        'UYU:Uruguayan peso\n' +
        'UZS:Uzbekistani sum\n' +
        'VES:Venezuelan bolívar\n' +
        'VND:Vietnamese đồng\n' +
        'VUV:Vanuatu vatu\n' +
        'WST:Samoan tālā\n' +
        'XAF:CFA franc BEAC\n' +
        'XCD:East Caribbean dollar\n' +
        'XDR:IMF special drawing rights\n' +
        'XOF:CFA franc BCEAO\n' +
        'XPF:CFP franc\n' +
        'YER:Yemeni rial\n' +
        'ZAR:South African rand\n' +
        'ZMW:Zambian kwacha\n' +
        'ZWL:Zimbabwean dollar';

    var list = [];
    RAW.split('\n').forEach(function (line) {
        var i = line.indexOf(':');
        if (i < 1) return;
        var code = line.slice(0, i).trim();
        var name = line.slice(i + 1).trim();
        if (code && name) list.push({ code: code, name: name });
    });
    list.sort(function (a, b) {
        return a.code.localeCompare(b.code);
    });
    global.REPORTING_CURRENCIES = list;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
